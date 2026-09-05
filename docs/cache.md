# Arquitetura de Cache

Este documento descreve a arquitetura, as decisões técnicas e o funcionamento da camada de cache em memória na rota `GET /cep/:cep`.

---

## 1. Visão Geral

A camada de cache atua como primeira linha de defesa antes das consultas externas às APIs (ViaCEP e BrasilAPI):

- **Baixa Latência:** Respostas com cache hit retornam em menos de **5ms**.
- **Resiliência:** Mesmo com provedores instáveis ou esgotamento de rate limits externos, consultas repetidas são atendidas com sucesso.
- **Economia de Rede:** Reduz tráfego de rede e consumo de recursos externos.

---

## 2. Funcionamento do Interceptor (`CepCacheInterceptor`)

Localizado em `src/modules/cep/presentation/interceptors/cep-cache.interceptor.ts`.

```
                  ┌───────────────────────────────┐
                  │  Cliente HTTP (GET /cep/:cep) │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                   ┌────────────────────────────┐
                   │    CepCacheInterceptor    │
                   └──────┬───────────────┬─────┘
           (Cache Hit)    │               │ (Cache Miss)
        ┌─────────────────┘               └────────────────┐
        ▼                                                  ▼
┌───────────────────┐                             ┌───────────────────┐
│ Retorna Resposta  │                             │  FindCepUseCase   │
│  (X-Cache: HIT)   │                             │ (Round-Robin e    │
└───────────────────┘                             │   Fallback)       │
                                                  └─────────┬─────────┘
                                                            │ Sucesso / 404
                                                            ▼
                                                  ┌───────────────────┐
                                                  │ Armazena no Cache │
                                                  │ (X-Cache: MISS)   │
                                                  └───────────────────┘
```

- **Normalização de Chave:** Normaliza o parâmetro `:cep` removendo hifens e caracteres não numéricos (`01001-000` ➔ `cep:01001000`).
- **Desacoplamento:** O caso de uso e o controller não contêm código de cache; o ciclo de vida é gerenciado por operadores RxJS (`tap` e `catchError`).

---

## 3. Negative Caching (Cache de 404)

Quando um CEP não existe, a aplicação consulta o primeiro provedor e, caso ele não encontre, aciona o **fallback** para consultar o próximo provedor da fila. Se nenhum dos provedores cadastrados encontrar o CEP, o caso de uso conclui que ele realmente não existe e lança `CepNotFoundException` (404).

Para evitar que essa verificação passe por todos os provedores repetidamente:

1. **Miss Inicial:** A primeira chamada percorre a cadeia de provedores (com fallback). Como nenhum encontrou, o sistema lança 404.
2. **Gravação:** O interceptor captura o 404 e grava `{ notFound: true }` no cache com TTL reduzido (`CACHE_NEGATIVE_TTL_MS`, padrão 10 minutos), retornando cabeçalho `X-Cache: MISS`.
3. **Hit Subsequente:** Chamadas seguintes para o mesmo CEP encontram a flag na memória e devolvem 404 imediatamente (`X-Cache: HIT`), sem acionar nenhum provedor externo.
4. **Erros Transitórios:** Falhas de rede, timeouts ou erros 5xx (`AllProvidersFailedException`) **não** são armazenados em cache, permitindo que novas tentativas ocorram normalmente.

---

## 4. Cabeçalho de Observabilidade (`X-Cache`)

| Valor | Significado |
| :--- | :--- |
| `X-Cache: HIT` | Resposta servida da memória local (latência < 5ms). |
| `X-Cache: MISS` | Chave inexistente; consulta realizada nos provedores e resultado gravado no cache. |

---

## 5. Extensibilidade (`CacheProvider`)

A camada utiliza o princípio de Inversão de Dependência via interface `CacheProvider` (`src/shared/cache/cache-provider.interface.ts`):

```typescript
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  clear?(): Promise<void>;
}
```

- **Implementação Padrão:** `LruCacheProvider` utilizando a biblioteca `lru-cache` (evicção $O(1)$, capacidade máxima configurada para evitar memory leaks).
- **Migração para Redis:** Basta criar uma classe `RedisCacheProvider implements CacheProvider` e alterar a resolução do token `CACHE_PROVIDER` no `CepModule`. Nenhuma regra de negócio precisa ser alterada.

---

## 6. Configuração via Ambiente

Valores validados no bootstrap via Zod (`src/shared/config/env.validation.ts`):

| Variável | Tipo | Padrão | Descrição |
| :--- | :---: | :---: | :--- |
| `CACHE_TTL_MS` | Number (> 0) | `86400000` (24h) | TTL para respostas de sucesso (`200 OK`). |
| `CACHE_NEGATIVE_TTL_MS` | Number (> 0) | `600000` (10 min) | TTL para respostas de CEP inexistente (`404 Not Found`). |

---

## 7. Testes Automatizados

- **Unitários:**
  - `test/unit/shared/lru-cache.provider.spec.ts`: Leitura, escrita, TTL com fake timers e evicção quando atinge capacidade máxima.
  - `test/unit/presentation/cep-cache.interceptor.spec.ts`: Cache Hit/Miss para 200 e 404, normalização de chave e não-cacheamento de erros 5xx.
- **Integração (`test/integration/cep.module.spec.ts`):** Resolução correta do token `CACHE_PROVIDER`.
- **E2E (`test/e2e/cep.e2e-spec.ts`):** Validação dos cabeçalhos `X-Cache: MISS` (1ª chamada) e `X-Cache: HIT` (2ª chamada) em requisições HTTP reais.

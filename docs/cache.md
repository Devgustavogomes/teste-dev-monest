# Arquitetura e Implementação de Cache

Este documento descreve a arquitetura, as decisões técnicas e o funcionamento da camada de cache implementada na rota `GET /cep/:cep`.

---

## 1. Visão Geral

A camada de cache foi concebida para atuar como uma primeira linha de defesa antes das consultas externas às APIs do **ViaCEP** e **BrasilAPI**.

### Principais Benefícios:

- **Redução drástica de latência:** Requisições em cache respondem em menos de 5ms
- **Resiliência:** Mesmo que provedores externos sofram instabilidade ou esgotem seus rate limits, consultas repetidas continuam sendo atendidas com sucesso.
- **Redução de custos e tráfego de rede:** Diminui expressivamente o volume de requisições enviadas a serviços de terceiros.

---

## 2. Implementação e Facilidade de Mudança (Extensibilidade)

### 2.1. Implementação Padrão com `lru-cache` (`LruCacheProvider`)

A implementação padrão é executada pela classe `LruCacheProvider` utilizando a biblioteca [`lru-cache`](https://www.npmjs.com/package/lru-cache):

- **Algoritmo LRU (_Least Recently Used_):** Mantém as entradas mais recentemente acessadas e descarta automaticamente as menos utilizadas assim que a capacidade máxima (`max: 1000` por padrão) é atingida, prevenindo qualquer risco de vazamento de memória (_memory leak_).
- **Performance $O(1)$:** Tanto as operações de leitura (`get`), escrita (`set`) quanto a evicção de nós ocorrem em tempo constante $O(1)$.
- **Controle de TTL por Item:** Cada entrada possui expiração temporal configurada em milissegundos..

### 2.2. Arquitetura Desacoplada: Fácil de Trocar a Qualquer Momento

A camada foi desenhada de forma 100% desacoplada da biblioteca concreta:

- **Baseada em Interface (`CacheProvider`):** O interceptor HTTP e os casos de uso dependem exclusivamente do contrato abstrato `CacheProvider` e do token de injeção `CACHE_PROVIDER`.
- **Plug-and-Play para Outras Tecnologias:** Caso no futuro seja necessário adotar uma solução de cache distribuído (como **Redis**, **Memcached** ou **DynamoDB**) para atender múltiplos nós da aplicação:
  1. Basta criar uma nova classe implementando a interface (ex.: `RedisCacheProvider implements CacheProvider`).
  2. Alterar apenas o provider no módulo `CepModule`:
     ```typescript
     {
       provide: CACHE_PROVIDER,
       useClass: RedisCacheProvider, // substituição imediata sem alterar regras de negócio
     }
     ```
  3. **Zero impacto:** Nenhuma linha do `CepCacheInterceptor`, dos Casos de Uso ou dos Controllers precisa ser alterada.

---

## 3. Arquitetura e Padrões de Projeto

A solução foi desenvolvida seguindo os princípios **SOLID**, em especial a **Inversão de Dependência (DIP)** e o princípio de **Responsabilidade Única (SRP)**.

```
                  ┌───────────────────────────────┐
                  │  Cliente HTTP (GET /cep/:cep) │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                   ┌────────────────────────────┐
                   │   CepCacheInterceptor      │
                   └──────┬───────────────┬─────┘
           (Cache Hit)    │               │ (Cache Miss)
        ┌─────────────────┘               └────────────────┐
        ▼                                                  ▼
┌───────────────────┐                             ┌───────────────────┐
│ Retorna Resposta  │                             │  BuscarCepUseCase │
│  (X-Cache: HIT)   │                             │  (Round Robin &   │
└───────────────────┘                             │     Fallback)     │
                                                  └─────────┬─────────┘
                                                            │
                                                            ▼
                                                  ┌───────────────────┐
                                                  │ Provedores (APIs) │
                                                  └─────────┬─────────┘
                                                            │ Sucesso / 404
                                                            ▼
                                                  ┌───────────────────┐
                                                  │ Armazena no Cache │
                                                  │  (X-Cache: MISS)  │
                                                  └───────────────────┘
```

### 3.1. Interceptor Pattern (`CepCacheInterceptor`)

Localizado em `src/modules/cep/presentation/interceptors/cep-cache.interceptor.ts`.

- **Por que um Interceptor?** Permite interceptar a requisição antes de atingir o controller/use-case e manipular a resposta pós-execução via operadores RxJS (`tap` e `catchError`), mantendo o Controller e os Use Cases 100% livres de regras de infraestrutura de cache.
- **Normalização de Chave:** Normaliza o parâmetro `:cep` removendo qualquer caractere não numérico (`01001-000` ➔ `cep:01001000`). Se o CEP não possuir exatamente 8 dígitos numéricos, o interceptor ignora o cache e delega a validação aos pipes e schemas Zod.

### 3.2. Strategy / Adapter Pattern (`CacheProvider`)

Definido em `src/shared/cache/cache-provider.interface.ts`.

- **Contrato Abstrato:**
  ```typescript
  export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
    clear?(): Promise<void>;
  }
  ```
- **Injeção via Token (`CACHE_PROVIDER`):** O módulo `CepModule` vincula o token `CACHE_PROVIDER` à implementação `LruCacheProvider`. Se no futuro a aplicação migrar para Redis, basta criar uma classe `RedisCacheProvider implements CacheProvider` e registrá-la no módulo, sem modificar uma única linha do `CepCacheInterceptor` ou dos Casos de Uso.

---

## 4. Negative Caching (Cache de CEPs Inexistentes - 404)

Consultar CEPs inválidos ou inexistentes (ex.: `00000000`) consome recursos significativos, pois força a aplicação a executar todo o ciclo de fallback por todas as APIs externas antes de concluir que o CEP não existe.

### Como Funciona:

1. **Miss Inicial:** A primeira requisição a um CEP inexistente consulta os provedores externos. Todos retornam inexistência e o caso de uso lança `CepNotFoundException` (`404 Not Found`).
2. **Captura e Gravação:** O operador `catchError` do `CepCacheInterceptor` captura o erro e armazena uma entrada negativa no cache:
   ```typescript
   {
     notFound: true;
   }
   ```
   com um TTL reduzido (`CACHE_NEGATIVE_TTL_MS`, padrão de 10 minutos). O erro é propagado com o cabeçalho `X-Cache: MISS`.
3. **Hit Subsequente:** Chamadas posteriores para o mesmo CEP encontram a flag `{ notFound: true }` no cache e lançam `CepNotFoundException` de imediato, adicionando o cabeçalho `X-Cache: HIT`, sem realizar nenhuma chamada externa.
4. **Erros Não Cacheados:** Erros transitórios como falhas de rede ou indisponibilidade de todos os provedores (`AllProvidersFailedException` - `502 Bad Gateway`) **nunca** são cacheados, garantindo que novas tentativas possam ter sucesso assim que as APIs externas se restabelecerem.

---

## 5. Observabilidade: Cabeçalhos HTTP (`X-Cache`)

Todas as respostas da rota `/cep/:cep` contêm o cabeçalho HTTP `X-Cache`:

| Valor do Header | Significado                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Cache: HIT`  | A resposta foi entregue diretamente a partir da memória local (tempo < 5ms).                                                                            |
| `X-Cache: MISS` | A chave não existia no cache. A consulta foi executada nas APIs externas e, em caso de 200 ou 404, o resultado foi armazenado para requisições futuras. |

---

## 6. Configuração e Variáveis de Ambiente

Os parâmetros de cache são configurados via variáveis de ambiente e validados estritamente no bootstrap com Zod em `src/shared/config/env.validation.ts`:

| Variável                | Tipo             | Padrão            | Descrição                                                            |
| ----------------------- | ---------------- | ----------------- | -------------------------------------------------------------------- |
| `CACHE_TTL_MS`          | Inteiro positivo | `86400000` (24h)  | Tempo de vida no cache para CEPs encontrados com sucesso (`200 OK`). |
| `CACHE_NEGATIVE_TTL_MS` | Inteiro positivo | `600000` (10 min) | Tempo de vida no cache para CEPs inexistentes (`404 Not Found`).     |

### Exemplo no `.env`:

```env
CACHE_TTL_MS=86400000
CACHE_NEGATIVE_TTL_MS=600000
```

---

## 7. Verificação e Testes Automatizados

A suíte de testes cobre integralmente todos os cenários da camada de cache:

1. **Testes Unitários:**
   - `test/unit/shared/lru-cache.provider.spec.ts`: Valida leitura, escrita, sobrescrita, expiração temporal via fake timers, limpeza geral e **evicção LRU quando a capacidade máxima é ultrapassada**.
   - `test/unit/presentation/cep-cache.interceptor.spec.ts`: Valida Cache Hit (200 e 404), Cache Miss (gravação em sucesso e em 404), propagação de erros de rede sem cache e normalização de chaves.
2. **Testes de Integração:**
   - `test/integration/cep.module.spec.ts`: Garante que o NestJS resolve o token `CACHE_PROVIDER` para uma instância válida de `LruCacheProvider`.
3. **Testes End-to-End (E2E):**
   - `test/e2e/cep.e2e-spec.ts`: Executa requisições HTTP reais contra a aplicação inicializada:
     - 1ª chamada com CEP real ➔ `200 OK` com `X-Cache: MISS`.
     - 2ª chamada imediata com CEP real ➔ `200 OK` com `X-Cache: HIT` em menos de 5ms.
     - 1ª chamada com CEP inexistente ➔ `404 Not Found` com `X-Cache: MISS`.
     - 2ª chamada imediata com CEP inexistente ➔ `404 Not Found` com `X-Cache: HIT`.

### Comandos de Execução:

```bash
# Executar todos os testes
npm test

# Executar relatório de cobertura (cobertura > 95%)
npm run test:coverage
```

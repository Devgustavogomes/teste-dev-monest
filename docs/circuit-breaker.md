# Arquitetura de Circuit Breaker

Este documento descreve a implementação do padrão **Circuit Breaker** (utilizando [`opossum`](https://nodeshift.dev/opossum/)) para proteção contra falhas em cascata e lentidão nos provedores externos de CEP.

---

## 1. Visão Geral

- **Fail-Fast:** Ao atingir o limiar crítico de falhas, o circuito abre e rejeita requisições subsequentes em menos de **1ms**, sem desperdiçar conexões de rede ou aguardar timeouts.
- **Isolamento por Provedor:** Cada provedor possui sua própria instância de disjuntor. A instabilidade do ViaCEP não afeta a disponibilidade do BrasilAPI (e vice-versa).
- **Auto-Recuperação (Self-Healing):** Após o período de resfriamento, o circuito transita para *Half-Open* e envia uma requisição piloto para testar a recuperação do serviço externo.
- **Transparência de Domínio:** O caso de uso (`FindCepUseCase`) interage apenas com a interface `CepProvider`, sem conhecimento da biblioteca de resiliência.

---

## 2. Máquina de Estados

```
              ┌──────────────────────────────┐
              │            CLOSED            │ ◄─────────────────────────┐
              │  (Operação normal de rede)   │                           │
              └──────────────┬───────────────┘                           │
                             │                                           │
                    Taxa de falhas > %                                   │ Teste com
                    e volume >= mínimo                                   │ SUCESSO
                             │                                           │
                             ▼                                           │
              ┌──────────────────────────────┐                           │
              │             OPEN             │                           │
              │   (Fail-Fast: rejeita sem    │                           │
              │    fazer chamada de rede)    │                           │
              └──────────────┬───────────────┘                           │
                             │                                           │
                      Após resetTimeout                                  │
                             │                                           │
                             ▼                                           │
              ┌──────────────────────────────┐                           │
              │          HALF-OPEN           │                           │
              │   (Requisição de teste)      ├───────────────────────────┘
              └──────────────┬───────────────┘
                             │
                             │ Teste FALHOU
                             ▼
                     (Retorna para OPEN)
```

1. **Closed:** Requisições são enviadas normalmente. A janela estatística monitora taxa de erros.
2. **Open:** Requisições são rejeitadas instantaneamente com erro, acionando o fallback no `FindCepUseCase`.
3. **Half-Open:** Uma requisição piloto testa o parceiro. Se tiver sucesso, volta para **Closed**; se falhar, retorna para **Open**.

---

## 3. Padrão Decorator & Extensibilidade

O `CircuitBreakerCepProvider` empacota qualquer implementação de `CepProvider` sem modificar sua interface:

```typescript
// src/shared/circuit-breaker/circuit-breaker-cep-provider.ts
export class CircuitBreakerCepProvider implements CepProvider {
  readonly name: string;
  private readonly breaker: CircuitBreaker<[string], CepResponse | null>;

  constructor(provider: CepProvider, options: CircuitBreakerOptions) {
    this.name = `CircuitBreaker(${provider.name})`;
    this.breaker = new CircuitBreaker((cep: string) => provider.find(cep), options);
  }

  find(cep: string): Promise<CepResponse | null> {
    return this.breaker.fire(cep);
  }
}
```

### Injeção de Dependência no `CepModule`
No arquivo `src/modules/cep/cep.module.ts`, o token `CEP_PROVIDERS` aplica automaticamente o decorator a todos os provedores injetados:

```typescript
const providers: CepProvider[] = [viaCep, brasilApi];
return providers.map((p) => new CircuitBreakerCepProvider(p, options));
```

> **Adicionar novo provedor:** Basta criar uma classe que implementa `CepProvider` e adicioná-la à lista de providers do `CepModule`. Nenhuma alteração no decorator ou no caso de uso é necessária.

---

## 4. Política de Falhas

| Cenário | Comportamento do Provedor | Contabiliza Falha no Circuit Breaker? | Ação no Caso de Uso |
| :--- | :--- | :---: | :--- |
| **CEP Inexistente (404)** | Retorna `null` | ❌ **Não** (Sucesso de negócio) | Registra ausência; tenta próximo provedor se houver. |
| **Timeout de Rede** | Lança erro de timeout | ✅ **Sim** | Faz fallback imediato para o próximo provedor. |
| **Erro HTTP 5xx / Rede** | Lança exceção de conexão | ✅ **Sim** | Faz fallback imediato para o próximo provedor. |
| **Violação de Contrato** | Lança `ProviderContractException` | ✅ **Sim** | Loga erro, registra métrica e faz fallback. |
| **Circuito ABERTO** | Rejeição imediata (`<1ms`) | N/A *(Fail-Fast)* | Tenta próximo provedor sem gerar I/O de rede. |

---

## 5. Configuração via Ambiente

Valores validados no bootstrap via Zod (`src/shared/config/env.validation.ts`):

| Variável | Tipo | Padrão | Descrição |
| :--- | :---: | :---: | :--- |
| `CB_ERROR_THRESHOLD_PERCENTAGE` | Number (1-100) | `50` | % de falhas na janela para abrir o circuito. |
| `CB_RESET_TIMEOUT_MS` | Number | `30000` | Tempo (ms) em estado aberto antes de testar em *Half-Open*. |
| `CB_VOLUME_THRESHOLD` | Number | `5` | Volume mínimo de requisições na janela para calcular erros. |
| `CEP_PROVIDER_TIMEOUT_MS` | Number | `5000` | Timeout máximo (ms) permitido por requisição individual. |

---

## 6. Testes Automatizados

- **Unitários (`test/unit/shared/circuit-breaker-cep-provider.spec.ts`):** Valida execução em modo fechado, abertura por threshold, retorno `null` sem penalidade, transição para *Half-Open* e encerramento limpo de timers com `shutdown()`.
- **Integração (`test/integration/cep.module.spec.ts`):** Valida injeção no container NestJS e comportamento de fail-fast/fallback em cenário de indisponibilidade simulada.

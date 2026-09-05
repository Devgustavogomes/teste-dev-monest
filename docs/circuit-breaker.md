# Arquitetura e Implementação de Circuit Breaker

Este documento descreve a arquitetura, decisões técnicas, padrões de projeto e o funcionamento da camada de **Circuit Breaker** implementada para proteger a aplicação contra falhas em cascata nas consultas aos provedores externos de CEP (**ViaCEP** e **BrasilAPI**).

---

## 1. Visão Geral

Ao consumir APIs externas de terceiros, falhas de rede, timeouts prolongados ou instabilidades (erros 5xx) são inevitáveis. O padrão **Circuit Breaker** (implementado com a biblioteca [`opossum`](https://nodeshift.dev/opossum/)) age como um disjuntor elétrico em volta de cada provedor externo:

### Principais Benefícios:

- **Fail-Fast (Falha Rápida):** Quando um provedor atinge uma taxa de falhas crítica, o circuito se abre imediatamente. Novas requisições para esse provedor são rejeitadas instantaneamente sem esperar timeouts de rede, economizando recursos computacionais e conexões HTTP.
- **Isolamento de Falhas por Provedor:** Cada provedor possui sua própria instância de circuit breaker. Se o **ViaCEP** cair, apenas o circuito dele é aberto; o **BrasilAPI** continua recebendo requisições normalmente (e vice-versa).
- **Recuperação Automática (Self-Healing):** Após um período de resfriamento (_reset timeout_), o circuito testa a disponibilidade do serviço de forma controlada (_half-open_), restabelecendo o fluxo normal assim que o provedor se recuperar.
- **Transparência para o Domínio:** Os casos de uso não sofrem alterações nem dependem de detalhes da biblioteca do circuit breaker.

---

## 2. Estados do Circuit Breaker (Máquina de Estados)

O opossum gerencia três estados fundamentais:

```
                  ┌──────────────────────────────┐
                  │            CLOSED            │ ◄─────────────────────────┐
                  │ (Operação normal: requisições │                           │
                  │   são enviadas ao provedor)  │                           │
                  └──────────────┬───────────────┘                           │
                                 │                                           │
                        Taxa de falhas > %                                   │ Teste de
                        e volume >= mínimo                                   │ requisição
                                 │                                           │ com SUCESSO
                                 ▼                                           │
                  ┌──────────────────────────────┐                           │
                  │             OPEN             │                           │
                  │ (Disjuntor aberto: rejeita   │                           │
                  │   imediatamente com erro)    │                           │
                  └──────────────┬───────────────┘                           │
                                 │                                           │
                          Após resetTimeout                                  │
                          (tempo esgotado)                                   │
                                 │                                           │
                                 ▼                                           │
                  ┌──────────────────────────────┐                           │
                  │          HALF-OPEN           │                           │
                  │ (Permite requisição de teste)├───────────────────────────┘
                  └──────────────┬───────────────┘
                                 │
                                 │ Teste FALHOU
                                 ▼
                         (Retorna para OPEN)
```

1. **Closed (Fechado):** Estado padrão. Todas as chamadas para o método `find(cep)` são executadas normalmente contra o serviço externo. O opossum monitora a janela deslizante de erros.
2. **Open (Aberto):** Se a taxa de erros ultrapassar o percentual configurado (`CB_ERROR_THRESHOLD_PERCENTAGE`) e houver o volume mínimo de requisições (`CB_VOLUME_THRESHOLD`), o circuito abre. Toda nova tentativa falha instantaneamente via rejeição rápida (_fail-fast_), caindo no mecanismo de fallback do `FindCepUseCase`.
3. **Half-Open (Semi-Aberto):** Expirado o tempo de espera (`CB_RESET_TIMEOUT_MS`), o disjuntor permite que uma requisição piloto passe:
   - Se responder com sucesso, o circuito fecha (**Closed**) e zera as métricas de falha.
   - Se falhar, o circuito reabre imediatamente (**Open**) por mais um ciclo de `CB_RESET_TIMEOUT_MS`.

---

## 3. Arquitetura e Padrão de Projeto: Decorator Pattern

A solução foi desenvolvida respeitando **Clean Architecture** e princípios **SOLID** (em especial **Open/Closed Principle** e **Single Responsibility Principle**).

```
                            ┌────────────────────────┐
                            │     FindCepUseCase     │
                            └───────────┬────────────┘
                                        │
                                        │ consome CepProvider[]
                                        ▼
                   ┌──────────────────────────────────────────┐
                   │  CircuitBreakerCepProvider (Decorator)   │
                   │  - implementa: CepProvider               │
                   │  - gerencia: opossum CircuitBreaker      │
                   └────────────────────┬─────────────────────┘
                                        │
                         (Se circuito FECHADO / HALF-OPEN)
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
             ┌─────────────────────┐         ┌─────────────────────┐
             │   ViaCepProvider    │         │  BrasilApiProvider  │
             │   (Provedor Real)   │         │   (Provedor Real)   │
             └─────────────────────┘         └─────────────────────┘
```

### 3.1. Implementação do Decorator (`CircuitBreakerCepProvider`)

Localizado em `src/shared/circuit-breaker/circuit-breaker-cep-provider.ts`.

A classe envolve uma instância de `CepProvider` original sem alterar sua assinatura:

```typescript
export class CircuitBreakerCepProvider implements CepProvider {
  readonly name: string;
  private readonly breaker: CircuitBreaker<[string], CepResponse | null>;

  constructor(provider: CepProvider, options: CircuitBreakerOptions) {
    this.name = `CircuitBreaker(${provider.name})`;
    this.breaker = new CircuitBreaker(
      (cep: string) => provider.find(cep),
      options,
    );
  }

  find(cep: string): Promise<CepResponse | null> {
    return this.breaker.fire(cep);
  }

  get circuit(): CircuitBreaker<[string], CepResponse | null> {
    return this.breaker;
  }
}
```

### 3.2. Extensibilidade e Injeção de Dependências

No módulo `CepModule` (`src/modules/cep/cep.module.ts`), a injeção do token `CEP_PROVIDERS` aplica automaticamente o Decorator sobre cada provedor configurado:

```typescript
{
  provide: CEP_PROVIDERS,
  useFactory: (
    viaCep: ViaCepProvider,
    brasilApi: BrasilApiProvider,
    configService: ConfigService<Env, true>,
  ) => {
    const options = {
      errorThresholdPercentage: configService.get('CB_ERROR_THRESHOLD_PERCENTAGE', { infer: true }),
      resetTimeout: configService.get('CB_RESET_TIMEOUT_MS', { infer: true }),
      timeout: configService.get('CEP_PROVIDER_TIMEOUT_MS', { infer: true }),
      volumeThreshold: configService.get('CB_VOLUME_THRESHOLD', { infer: true }),
    };

    const providers: CepProvider[] = [viaCep, brasilApi];
    return providers.map(p => new CircuitBreakerCepProvider(p, options));
  },
  inject: [ViaCepProvider, BrasilApiProvider, ConfigService],
}
```

> **Como adicionar um novo provedor no futuro?**
>
> 1. Crie a nova classe implementando a interface `CepProvider` (ex.: `OpenCepProvider`).
> 2. Adicione-o no array de providers da factory no `CepModule`.
>
> **Zero código adicional de circuit breaker é necessário.** Ele será empacotado automaticamente.

---

## 4. Política de Falhas e Tratamento de Erros

Nem todo retorno negativo de uma API externa é considerado uma falha de infraestrutura:

| Cenário                             | Comportamento do Provedor   | Contabiliza Falha no Circuit Breaker? | Justificativa                                                                |
| :---------------------------------- | :-------------------------- | :-----------------------------------: | :--------------------------------------------------------------------------- |
| **CEP Inexistente (404)**           | Retorna `null`              |              ❌ **Não**               | Resposta de negócio válida. O serviço externo está funcionando corretamente. |
| **Timeout (rede lenta)**            | Lança exceção de timeout    |              ✅ **Sim**               | Falha de infraestrutura ou sobrecarga da API externa.                        |
| **Erro HTTP 5xx / 500 / 502 / 503** | Lança `AxiosError`          |              ✅ **Sim**               | Instabilidade ou indisponibilidade no serviço do parceiro.                   |
| **Erro de DNS / Conexão recusada**  | Lança `AxiosError`          |              ✅ **Sim**               | Quebra de conectividade de rede.                                             |
| **Circuito ABERTO**                 | Lança `Error` imediatamente |            N/A (já aberto)            | Fail-fast: a requisição é interceptada antes de ir à rede.                   |

### Fluxo no `FindCepUseCase`

O `FindCepUseCase` itera sobre a sequência ordenada pelo `RoundRobinStrategy`:

```typescript
for (const provider of providers) {
  try {
    const result = await provider.find(cep);
    if (result !== null) return result;
    notFound = true;
  } catch {
    // Falha técnica no provider ou Circuit Breaker ABERTO:
    // Captura o erro instantaneamente e tenta o próximo provider da fila
  }
}
```

Quando o circuito de um provedor está aberto, o método `find()` é rejeitado em menos de **1ms**, permitindo que o caso de uso avance imediatamente para o próximo provedor saudável sem qualquer penalidade de latência.

---

## 5. Configuração e Variáveis de Ambiente

As configurações do Circuit Breaker são validadas na inicialização via Zod em `src/shared/config/env.validation.ts`:

| Variável                        |      Tipo       | Default | Descrição                                                                                       |
| :------------------------------ | :-------------: | :-----: | :---------------------------------------------------------------------------------------------- |
| `CB_ERROR_THRESHOLD_PERCENTAGE` | Inteiro (1-100) |  `50`   | Porcentagem de erros necessária para abrir o circuito.                                          |
| `CB_RESET_TIMEOUT_MS`           |  Inteiro (> 0)  | `30000` | Tempo (em ms) que o circuito permanece aberto antes de testar em _half-open_ (30 segundos).     |
| `CB_VOLUME_THRESHOLD`           |  Inteiro (> 0)  |   `5`   | Número mínimo de requisições na janela estatística antes de calcular o percentual de erro.      |
| `CEP_PROVIDER_TIMEOUT_MS`       |  Inteiro (> 0)  | `5000`  | Reutilizado para definir o tempo limite de execução de cada requisição no opossum (5 segundos). |

Exemplo de configuração no `.env`:

```bash
# Circuit Breaker
CB_ERROR_THRESHOLD_PERCENTAGE=50
CB_RESET_TIMEOUT_MS=30000
CB_VOLUME_THRESHOLD=5
CEP_PROVIDER_TIMEOUT_MS=5000
```

---

## 6. Estratégia de Testes

A integridade do mecanismo é garantida através de testes unitários e de integração:

### 6.1. Testes Unitários (`test/unit/circuit-breaker-cep-provider.spec.ts`)

- Validação do repasse transparente de chamadas em estado fechado (**Closed**).
- Verificação de abertura de circuito após atingir o threshold de falhas (**Open**).
- Garantia de que retorno `null` (CEP não encontrado) não conta como erro e não abre o circuito.
- Teste de recuperação do circuito para **Half-Open** e subsequente fechamento após sucesso.
- Limpeza dos timers do opossum (`circuit.shutdown()`) para prevenir memory leaks em ambiente de teste.

### 6.2. Testes de Integração (`test/integration/cep.module.spec.ts`)

- Validação de que os providers instanciados no container do NestJS estão devidamente decorados por `CircuitBreakerCepProvider`.
- Teste de **fail-fast e fallback**: simulando indisponibilidade de rede, verificando que requisições subsequentes falham sem nem tentar disparar chamadas HTTP.

---

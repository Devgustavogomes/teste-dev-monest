# Arquitetura de Observabilidade & Telemetria

Este documento descreve a arquitetura, decisões técnicas e comportamento operacional da stack de observabilidade da aplicação, abrangendo **Logging Estruturado**, **Rastreamento Distribuído (Distributed Tracing)** e **Métricas de Negócio** com **OpenTelemetry** e **Pino**.

---

## 1. Visão Geral & Decisões Arquiteturais

A observabilidade foi projetada sobre três pilares unificados, com baixo overhead de execução e adesão a padrões abertos de mercado (CNCF / W3C):

```
                                  REQUISIÇÃO HTTP (Entrada)
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
             [OpenTelemetry SDK]                            [Pino Logger]
       Gera trace_id & span_id (W3C)                Gera req.id local (UUID v4)
                       │                                           │
                       └─────────────────────┬─────────────────────┘
                                             │
                                             ▼
                             Logs Correlacionados via Mixin:
                       { req.id, trace_id, span_id, durationMs, ... }
                                             │
                        ┌────────────────────┼────────────────────┐
                        ▼                    ▼                    ▼
                [Traces OTLP]          [Métricas OTLP]       [Logs JSON]
              (Grafana/Tempo)         (Prometheus/Mimir)     (Loki/ELK)
```

### Por que OpenTelemetry (OTel)?
- **Padrão Neutro da Indústria:** Evita acoplamento proprietário (vendor lock-in) com fornecedores específicos como Datadog, Dynatrace ou New Relic. A aplicação exporta via protocolo aberto **OTLP** (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- **Context Propagation W3C:** Propaga o cabeçalho `traceparent` padronizado entre sistemas distribuídos.
- **Instrumentação Automática Seletiva:** Inicializado via `src/instrumentation.ts` antes do bootstrap do NestJS, instrumentando chamadas HTTP (`express`, `axios`/`http`), desativando instrumentações ruidosas (`fs`, `dns`).

---

## 2. Configuração & Variáveis de Ambiente

Todas as configurações são estritamente validadas na inicialização via Zod em `src/shared/config/env.validation.ts`:

| Variável | Tipo | Padrão | Descrição |
| :--- | :---: | :---: | :--- |
| `LOG_LEVEL` | Enum (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) | `info` | Nível mínimo de severidade do Pino. |
| `OTEL_SERVICE_NAME` | String | `api-cep` | Identificador do serviço nas traces e métricas. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL (opcional) | `undefined` | Endpoint do coletor OTLP (ex: `http://otel-collector:4318`). |

---

## 3. Correlação de Logs e Traces (`traceCorrelationMixin`)

Em `src/app.module.ts`, o `pino-http` injeta dinamicamente o contexto ativo do OpenTelemetry em **todas** as linhas de log:

```typescript
export const traceCorrelationMixin = () => {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    return {};
  }
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
};
```

### Diferença entre `req.id`, `trace_id` e `span_id`

- **`req.id` (Local):** UUID v4 gerado pelo Pino para identificar aquela requisição HTTP específica nesta instância do NestJS.
- **`trace_id` (Global W3C):** Identificador de 32 caracteres hexadecimais que representa a transação de ponta a ponta através de todos os serviços.
- **`span_id` (Etapa W3C):** Identificador de 16 caracteres hexadecimais que localiza a operação atômica exata (ex: chamada de saída à ViaCEP).

---

## 4. Métricas de Negócio & Resiliência (`TelemetryMetricsService`)

Implementado em `src/shared/observability/telemetry-metrics.service.ts`, registra métricas sob o medidor `api-cep`:

### Instrumentos Coletados

| Nome da Métrica | Tipo OTel | Atributos (Labels) | Finalidade Operacional |
| :--- | :---: | :--- | :--- |
| `cep_requests_total` | Counter | `provider`, `status` (`success`, `fallback`, `not_found`, `error`) | Mede taxa de sucesso e fallbacks por provedor em tempo real. |
| `cep_cache_requests_total` | Counter | `result` (`hit`, `miss`, `negative_hit`) | Permite calcular o **Cache Hit Ratio** e a eficácia do Negative Caching. |
| `circuit_breaker_state` | UpDownCounter | `provider` | Monitora o estado da proteção: `0=Closed`, `1=Open`, `2=Half-Open`. |

### Princípio de Não-Ruptura
Todas as operações de registro de métricas são envolvidas em blocos `try/catch` defensivos:
> **A telemetria nunca pode interromper ou falhar uma requisição de negócio do usuário.**

---

## 5. Inicialização da Instrumentação (`src/instrumentation.ts`)

A inicialização do SDK ocorre antes de qualquer módulo da aplicação ser carregado, garantindo o patch correto das bibliotecas nativas de rede (`http`/`https`):

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

export const { sdk, shutdown } = initializeInstrumentation();
```

O encerramento gracioso (*graceful shutdown*) é interceptado via `SIGTERM` e `SIGINT` para garantir o esvaziamento (*flush*) de métricas e traces pendentes no buffer de exportação.

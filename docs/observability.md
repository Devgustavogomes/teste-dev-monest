# Arquitetura de Observabilidade & Telemetria

Este documento descreve a stack de observabilidade da aplicação, abrangendo **Logging Estruturado (Pino)**, **Rastreamento Distribuído W3C** e **Métricas de Negócio** com **OpenTelemetry (OTel)**.

---

## 1. Visão Geral

A arquitetura unifica logs, traces e métricas sob padrões abertos CNCF, garantindo baixo overhead e independência de fornecedor (*vendor-neutral*):

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

---

## 2. Correlação de Logs e Traces (`traceCorrelationMixin`)

Em `src/app.module.ts`, o `pino-http` injeta o contexto do OpenTelemetry em **todas** as linhas de log:

```typescript
export const traceCorrelationMixin = () => {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
};
```

### Identificadores:
- **`req.id` (Local):** UUID v4 gerado pelo Pino para identificar a requisição nesta instância.
- **`trace_id` (Global W3C):** Hexadecimal de 32 caracteres que rastreia a transação entre múltiplos serviços.
- **`span_id` (Etapa W3C):** Hexadecimal de 16 caracteres que identifica uma operação atômica específica.

---

## 3. Métricas de Negócio & Resiliência (`TelemetryMetricsService`)

Implementado em `src/shared/observability/telemetry-metrics.service.ts` sob o medidor `api-cep`:

| Métrica | Tipo | Labels | Finalidade |
| :--- | :---: | :--- | :--- |
| `cep_requests_total` | Counter | `provider`, `status` (`success`, `fallback`, `not_found`, `error`, `contract_violation`) | Mede taxa de sucesso, falhas, fallbacks e violações de schema por provedor. |
| `cep_cache_requests_total` | Counter | `result` (`hit`, `miss`, `negative_hit`) | Permite calcular taxa de acerto do cache (*Cache Hit Ratio*) e Negative Caching. |
| `circuit_breaker_state` | UpDownCounter | `provider` | Estado do circuito: `0=Closed`, `1=Open`, `2=Half-Open`. |

> **Princípio de Não-Ruptura:** O registro de métricas roda em blocos defensivos; falhas de telemetria nunca afetam o fluxo de negócio do usuário.

---

## 4. Detecção de Quebra de Contrato (`ProviderContractException`)

Quando uma API externa altera o formato de resposta e falha na validação Zod (`safeParse`):

1. **Log estruturado em nível `ERROR`:** Contém o código `PROVIDER_CONTRACT_VIOLATION` e a lista de `issues` detalhadas do schema.
2. **Métrica `cep_requests_total`:** Incrementada com `status: "contract_violation"`, permitindo configurar alertas imediatos no Prometheus / Alertmanager.
3. **Fallback Automático:** O `FindCepUseCase` captura o erro e avança para o próximo provedor.

---

## 5. Inicialização e Graceful Shutdown (`src/instrumentation.ts`)

- O SDK do OpenTelemetry é inicializado **antes** do bootstrap do NestJS para garantir o patch correto das bibliotecas de rede (`http`, `https`, `axios`).
- Encerramento gracioso interceptado em `SIGTERM` e `SIGINT` via `shutdown()`, esvaziando o buffer de métricas e traces pendentes.

---

## 6. Configuração via Ambiente

Valores validados no bootstrap via Zod (`src/shared/config/env.validation.ts`):

| Variável | Tipo | Padrão | Descrição |
| :--- | :---: | :---: | :--- |
| `LOG_LEVEL` | Enum (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) | `info` | Nível de severidade dos logs. |
| `OTEL_SERVICE_NAME` | String | `api-cep` | Nome do serviço em traces e métricas. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL (opcional) | `undefined` | Endpoint do coletor OTLP (ex: `http://otel-collector:4318`). |

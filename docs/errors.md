# Tratamento de Erros e Exceções

Este documento detalha o modelo de erros da aplicação, a taxonomia de exceções, o fluxo de fallback e a padronização das respostas HTTP.

---

## 1. Filosofia de Tratamento

O sistema separa estritamente os erros em duas categorias:

1. **Erros de Aplicação / Domínio (`AppError`):** Representam falhas de negócio ou validação (ex: CEP inválido, não encontrado ou todos os provedores indisponíveis). São mapeados para respostas HTTP previsíveis para o cliente.
2. **Erros Internos de Infraestrutura (`Error` / `ProviderContractException`):** Falhas transitórias de provedores externos (timeout, indisponibilidade 5xx ou resposta fora do contrato). São interceptados internamente para acionar métricas, logs e o mecanismo de **fallback** entre provedores, sem expor detalhes internos ao cliente.

---

## 2. Catálogo de Exceções

| Exceção | Tipo | HTTP Status | Causa | Ação do Sistema |
| :--- | :--- | :---: | :--- | :--- |
| `InvalidCepException` | `AppError` | `400 Bad Request` | Formato não possui 8 dígitos numéricos. | Rejeição imediata no pipe de validação. |
| `CepNotFoundException` | `AppError` | `404 Not Found` | CEP consultado não existe nos provedores. | Salva em cache negativo (10m) e retorna 404. |
| `AllProvidersFailedException` | `AppError` | `502 Bad Gateway` | Todos os provedores falharam (timeout, circuit breaker aberto ou erro 5xx). | Retorna 502 indicando falha nos upstreams. |
| `ProviderContractException` | `Error` (Interno) | N/A *(Fallback)* | Provedor externo alterou schema ou quebrou contrato Zod. | Loga `ERROR`, incrementa métrica `contract_violation` e tenta próximo provedor. |

---

## 3. Formato Padronizado de Resposta HTTP

Todas as exceções tratadas pelo `GlobalExceptionFilter` seguem uma estrutura padronizada:

```json
{
  "statusCode": 404,
  "message": "CEP 99999999 not found.",
  "error": "Not Found",
  "timestamp": "2026-09-05T18:30:00.000Z"
}
```

### Exemplos de Resposta:

- **400 Bad Request:**
  ```json
  {
    "statusCode": 400,
    "message": "Invalid CEP format. Must contain 8 numeric digits.",
    "error": "Bad Request",
    "timestamp": "2026-09-05T18:30:00.000Z"
  }
  ```

- **502 Bad Gateway:**
  ```json
  {
    "statusCode": 502,
    "message": "All CEP providers failed. Please try again later.",
    "error": "Bad Gateway",
    "timestamp": "2026-09-05T18:30:00.000Z"
  }
  ```

---

## 4. Fluxo de Tratamento no `GlobalExceptionFilter`

O `GlobalExceptionFilter` intercepta todas as exceções não capturadas:

```
[Exceção Lançada]
        │
        ▼
[GlobalExceptionFilter]
        ├── AppError ───────────────▶ Extrai status, message e error definidos
        ├── HttpException (NestJS) ─▶ Normaliza formato e mensagens
        └── Erro Desconhecido ──────▶ Status 500 ("Internal Server Error")
        │
        ▼
[Logging Estruturado com Pino]
        ├── 4xx ────────────────────▶ Log level WARN (path, method, statusCode)
        └── 5xx ────────────────────▶ Log level ERROR (inclui stack trace e err)
        │
        ▼
[Resposta HTTP JSON para o Cliente]
```

### Integração com Observabilidade
- Os logs de erro herdam automaticamente `trace_id`, `span_id` e `req.id`, permitindo correlacionar qualquer erro 4xx/5xx com o rastro do trace no OpenTelemetry.

---

## 5. Resiliência e Fallback entre Provedores

Quando um provedor externo falha no `FindCepUseCase`:

1. **Timeout (`CEP_PROVIDER_TIMEOUT_MS`):** Requisição abortada; fallback automático para o próximo provedor.
2. **Circuit Breaker Aberto (`Open`):** Requisição é rejeitada em fail-fast sem fazer chamada de rede; fallback automático.
3. **Violação de Contrato (`ProviderContractException`):**
   - Disparada quando o Zod detecta campos obrigatórios faltantes ou tipos incorretos no payload externo.
   - O use case captura a exceção, registra log com detalhes das issues Zod, incrementa `cep_requests_total{status="contract_violation"}` e executa o fallback.
4. **Exaustão:** Se todos os provedores falharem na mesma requisição, o use case dispara `AllProvidersFailedException` (502).

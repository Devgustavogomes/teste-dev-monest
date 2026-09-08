# Arquitetura do Sistema

Este documento descreve a visão geral da arquitetura, padrões de projeto e as decisões técnicas tomadas para garantir resiliência, abstração e observabilidade na API de consulta de CEP.

---

## 1. Visão Geral & Camadas (Clean Architecture)

A aplicação é estruturada com base nos princípios de **Clean Architecture** e **SOLID**, dividindo responsabilidades em camadas bem delimitadas:

```
                          REQUISIÇÃO HTTP
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │             CAMADA DE APRESENTAÇÃO               │
       │  • ThrottlerGuard (Rate Limiting por IP)         │
       │  • CepController (Swagger / OpenAPI)             │
       │  • ZodValidationPipe (Validação estrita de CEP)  │
       │  • CepCacheInterceptor (Cache LRU + Negative)    │
       │  • GlobalExceptionFilter (RFC 7807)              │
       └─────────────────────────┬────────────────────────┘
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │               CAMADA DE APLICAÇÃO                │
       │  • FindCepUseCase (Orquestração de negócio)      │
       │  • RoundRobinStrategy (Alternância de provedores)│
       └─────────────────────────┬────────────────────────┘
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │              CAMADA DE INFRAESTRUTURA            │
       │  • CircuitBreakerCepProvider (Opossum Decorator) │
       │  • BaseHttpCepProvider (Telemetry + safeParse)   │
       │  • ViaCepProvider & BrasilApiProvider            │
       │  • LruCacheProvider (Implementação CacheProvider)│
       │  • OpenTelemetry SDK & Pino Logger               │
       └──────────────────────────────────────────────────┘
```

---

## 2. Estrutura de Diretórios

A organização de pastas segue a separação por módulos e camadas de domínio, aplicação e infraestrutura:

```text
teste-dev-monest/
├── .github/workflows/         # Pipelines de CI/CD (lint, testes unitários, e2e e cobertura)
├── docs/                      # Documentação técnica e guias de arquitetura
├── src/
│   ├── modules/
│   │   ├── cep/               # Módulo de CEP (Clean Architecture)
│   │   │   ├── application/   # Casos de uso (FindCepUseCase)
│   │   │   ├── domain/        # Entidades, contratos/interfaces e erros de domínio
│   │   │   ├── infrastructure/# Provedores (ViaCep, BrasilApi, CircuitBreaker, BaseHttp)
│   │   │   └── presentation/  # Controllers, DTOs e interceptors de cache
│   │   └── health/            # Endpoint de liveness (/health)
│   ├── shared/                # Recursos compartilhados e infraestrutura transversal
│   │   ├── cache/             # Cache em memória (LRU provider e contrato)
│   │   ├── circuit-breaker/   # Configuração e wrapper Opossum
│   │   ├── config/            # Validação e tipagem de variáveis de ambiente com Zod
│   │   ├── errors/            # Exceções base da aplicação (AppError)
│   │   ├── filters/           # Tratamento global de exceções (RFC 7807)
│   │   ├── observability/     # Métricas OpenTelemetry e logger Pino estruturado
│   │   ├── pipes/             # Validação e transformação de dados (Zod)
│   │   └── strategies/        # Algoritmos de balanceamento (Round-Robin)
│   ├── app.module.ts          # Módulo raiz NestJS
│   ├── instrumentation.ts     # Bootstrap e inicialização do OpenTelemetry SDK
│   └── main.ts                # Ponto de entrada (Bootstrap HTTP, Swagger, graceful shutdown)
├── test/
│   ├── e2e/                   # Testes ponta a ponta (Supertest)
│   ├── integration/           # Testes de integração de fluxos e interceptors
│   └── unit/                  # Testes unitários de use cases, providers e strategies
├── Dockerfile                 # Build multi-stage (Node 24 Alpine)
├── docker-compose.yml         # Orquestração de containers local
└── vitest.config.ts           # Configuração de execução dos testes com Vitest
```

---

## 3. Decisões Arquiteturais por Pilar

### 3.1. Abstração & Extensibilidade (Open/Closed Principle)

- **Contrato Único (`CepProvider`):** O caso de uso (`FindCepUseCase`) depende exclusivamente da interface abstrata `CepProvider`, sem conhecer detalhes de Axios ou URLs externas.
- **Como adicionar um 3º provedor (ex: `OpenCep`):**
  1. Crie a classe implementando `CepProvider` (ou estendendo `BaseHttpCepProvider`);
  2. Adicione a nova classe no array do token `CEP_PROVIDERS` em `src/modules/cep/cep.module.ts`.
  - **Zero impacto:** Nenhuma linha do controller, caso de uso ou outros providers precisa ser modificada.

---

### 3.2. Resiliência em Camadas

O sistema aplica defesa em profundidade para lidar com instabilidades externas:

```
[Cliente] ──▶ [Cache LRU] ──(Miss)──▶ [Round-Robin] ──▶ [Circuit Breaker] ──▶ [API Externa]
                   │                                           │
             (Hit: <5ms)                             (Fail-Fast se aberto)
```

1. **Cache em Memória (`CepCacheInterceptor`):**
   - **Cache Positivo:** CEPs encontrados ficam em cache (TTL padrão: 24h).
   - **Negative Caching:** CEPs inexistentes (404) são cacheados temporariamente (TTL: 10m) para proteger os provedores contra ataques de enumeração.
   - Retorna cabeçalho `X-Cache: HIT` ou `MISS`.

2. **Alternância Determinística (`RoundRobinStrategy`):**
   - Alterna a prioridade das chamadas entre os provedores para balancear carga.

3. **Fallback Automático (`FindCepUseCase`):**
   - Se o primeiro provedor falhar (timeout, erro 5xx ou rede), o caso de uso tenta imediatamente o próximo provedor da sequência.

4. **Proteção de Circuito (`CircuitBreakerCepProvider`):**
   - Implementado via padrão **Decorator** com a biblioteca `opossum`.
   - Se um provedor acumular 50% de falhas, seu circuito **abre**, rejeitando requisições com *fail-fast* imediato sem gerar conexões de rede ou esperar timeouts.

5. **Timeouts Curtos:**
   - Limite rígido por provedor (padrão: 5000ms via `CEP_PROVIDER_TIMEOUT_MS`). A aplicação nunca aguarda 30 segundos.

---

### 3.3. Observabilidade e Telemetria Unificada

Construída sobre padrões abertos CNCF (W3C Trace Context e OpenTelemetry):

- **Correlação de Logs e Traces:** Cada linha de log do **Pino** inclui automaticamente `req.id` (UUID local), `trace_id` (W3C global) e `span_id`.
- **Métricas de Negócio em Tempo Real:**
  - `cep_requests_total`: Mede requisições por provedor e status (`success`, `fallback`, `not_found`, `contract_violation`).
  - `circuit_breaker_state`: Estado de cada disjuntor (`0=Closed`, `1=Open`, `2=Half-Open`).
  - `cep_cache_requests_total`: Mede taxa de acerto (`hit`, `miss`, `negative_hit`).
- **Healthcheck:** Endpoint nativo `GET /health` sem dependências externas para monitoramento de liveness.

---

### 3.4. Tratamento e Classificação de Erros

O sistema separa estritamente **erros públicos voltados ao cliente** de **erros internos de infraestrutura**:

| Erro / Exceção | Tipo | HTTP Status | Comportamento |
| :--- | :--- | :---: | :--- |
| `InvalidCepException` | `AppError` | `400 Bad Request` | CEP fora do formato (8 dígitos numéricos). |
| `CepNotFoundException` | `AppError` | `404 Not Found` | CEP não encontrado em nenhum provedor. Sujeito a Negative Caching. |
| `AllProvidersFailedException` | `AppError` | `502 Bad Gateway` | Todos os provedores falharam por timeout, indisponibilidade ou rede. |
| `ProviderContractException` | `Error` (Interno) | N/A (Fallback) | Validação defensiva Zod falhou no provedor. Loga `ERROR`, aciona métrica de alerta e faz fallback para o próximo provider. |
| `ThrottlerException` | `HttpException` | `429 Too Many Requests` | Limite de taxa de requisições excedido. Retorna cabeçalho `Retry-After`. |

---

### 3.5. Proteção por Rate Limiting (`@nestjs/throttler`)

A aplicação protege seus endpoints contra sobrecarga, raspagem em massa e ataques de negação de serviço através de limitação de taxa por IP:
- **Guard Global:** Registrado via `APP_GUARD` com `ThrottlerGuard`.
- **Configuração Flexível:** TTL (`THROTTLE_TTL_MS`, padrão 60.000 ms) e limite de requisições (`THROTTLE_LIMIT`, padrão 60 requisições) parametrizados via variáveis de ambiente.
- **Isenção de Healthcheck:** O endpoint `/health` é explicitamente marcado com `@SkipThrottle()` para permitir monitoramento contínuo e probes de orquestração sem falsos positivos.
- **Suporte a Proxies Reversos:** `trust proxy` configurado no Express para correta resolução de IPs de clientes em containers e atrás de load balancers.

---

## 4. Guias de Aprofundamento

Para detalhes específicos de implementação de cada componente:

- [Guia de Inicialização](./getting-started.md)
- [Tratamento de Erros e Exceções](./errors.md)
- [Arquitetura de Circuit Breaker](./circuit-breaker.md)
- [Arquitetura de Cache](./cache.md)
- [Arquitetura de Observabilidade & Telemetria](./observability.md)
- [Arquitetura de Containerização Docker](./docker.md)
- [Pipeline de Integração Contínua (CI)](./ci.md)

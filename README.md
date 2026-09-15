# Teste Técnico - Desenvolvedor

## 📚 Documentação Técnica

Para detalhes completos de arquitetura, execução e resiliência da solução implementada, consulte os guias em [`docs/`](./docs/):

- **[Guia Rápido (Getting Started)](./docs/getting-started.md)**: Como rodar a aplicação localmente e via Docker, endpoints e comandos de teste.
- **[Arquitetura e Design System](./docs/architecture.md)**: Decisões arquiteturais (Clean Architecture, Provider Pattern, Fallback Strategy).
- **[Resiliência e Circuit Breaker](./docs/circuit-breaker.md)**: Mecanismos de failover, timeouts e proteção contra cascata de falhas.
- **[Estratégia de Cache](./docs/cache.md)**: Cache em memória com TTL, eviction policy e headers (`X-Cache`).
- **[Observabilidade e Logs](./docs/observability.md)**: Estrutura de logs com Pino, tracing de requisições e métricas.
- **[Tratamento de Erros](./docs/errors.md)**: Mapeamento de erros, contratos RFC 7807 / uniformes e fallbacks.
- **[Containerização e Docker](./docs/docker.md)**: Multi-stage build, segurança e execução em containers.
- **[Integração Contínua (CI)](./docs/ci.md)**: Pipelines de validação automática com GitHub Actions.

---

## O problema

Você precisa criar uma API que consulta CEP. Simples, certo?

Só que: você não controla as APIs externas. Elas caem, demoram, retornam erro. Seu serviço precisa continuar funcionando.

## APIs disponíveis

- ViaCEP: `https://viacep.com.br/ws/{cep}/json/`
- BrasilAPI: `https://brasilapi.com.br/api/cep/v1/{cep}`

## Requisitos

### Endpoint
`GET /cep/{cep}`

### Comportamento esperado
- Alterna entre as duas APIs (pode ser aleatório ou round-robin)
- Se uma falhar, tenta a outra automaticamente
- Retorna um contrato único, independente de qual API respondeu

### O que queremos ver

1. **Abstração** — Como você isola os providers externos? Se amanhã adicionarmos uma terceira API, o que muda no código?

2. **Resiliência** — O que acontece quando uma API demora 30 segundos? E quando as duas estão fora?

3. **Observabilidade** — Se der erro em produção, como a gente descobre o que aconteceu?

4. **Tratamento de erros** — Erros diferentes devem ter tratamentos diferentes. Timeout não é a mesma coisa que 404.

## Stack

NestJS + TypeScript. Fora isso, use o que fizer sentido.

## O que não estamos avaliando

- Frontend
- Banco de dados
- Deploy
- Cobertura de testes de 100%

## Como entregar

Fork este repositório, implemente. Retorne ao e-mail em que você recebeu o teste e encaminhe seu resultado por lá com o assunto **Teste Dev - Monest**.
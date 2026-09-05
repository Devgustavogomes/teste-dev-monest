# Arquitetura e Pipeline de Integração Contínua (CI)

Este documento descreve a arquitetura, as decisões técnicas, os estágios de validação e o funcionamento das pipelines de **Integração Contínua (CI)** configuradas via **GitHub Actions** neste projeto.

---

## 1. Visão Geral

A pipeline de CI foi projetada para garantir que qualquer alteração de código passe por rigorosas verificações estáticas, de compilação e de testes automatizados antes de ser integrada à branch principal (`main`).

### Principais Benefícios:

- **Feedback Rápido e Paralelismo:** Workflows e jobs executam de forma independente e concorrente, minimizando o tempo total de resposta (_time-to-feedback_) para os desenvolvedores.
- **Enforcement Estrito de Qualidade:** Código com erros de tipagem, violações de estilo (ESLint/Prettier) ou quebras de testes é barrado automaticamente antes do merge.
- **Métricas e Governança de Cobertura:** Avaliação automática de cobertura de código com limite mínimo estipulado em **80%** e exportação de relatórios.
- **Determinismo e Reprodutibilidade:** Garantia de ambientes limpos e imutáveis com `npm ci` e cache inteligente das dependências do Node.js.

---

## 2. Estrutura dos Workflows e Gatilhos (Triggers)

A automação está dividida em dois workflows independentes no diretório `.github/workflows/`:

| Workflow             | Arquivo                      | Responsabilidade Principal                                                            |
| :------------------- | :--------------------------- | :------------------------------------------------------------------------------------ |
| **Lint & Typecheck** | `.github/workflows/lint.yml` | Análise estática, formatação e checagem de tipos estritos TypeScript.                 |
| **Tests**            | `.github/workflows/test.yml` | Execução da pirâmide de testes (Unitários, Integração e E2E) e métricas de cobertura. |

### 2.1. Gatilhos de Execução

Ambos os workflows são disparados automaticamente nos seguintes eventos:

```yaml
on:
  push:
    branches: ['main']
  pull_request:
    branches: ['main']
```

- **Em Pull Requests:** Valida preventivamente o código do contribuidor antes da aprovação e incorporação à branch `main`.
- **Em Pushes na `main`:** Garante a sanidade contínua do branch principal após merges ou commits diretos.

### 2.2. Ambiente e Configuração de Execução

Todos os jobs utilizam uma base padronizada e otimizada:

- **Sistema Operacional:** `ubuntu-latest`
- **Node.js:** Versão `20.x` (LTS)
- **Instalação Determinística:** `npm ci`, assegurando instalação estrita baseada nas versões exatas de `package-lock.json`.
- **Estratégia de Cache:** `cache: 'npm'` integrado à action `actions/setup-node@v4`, acelerando downloads recorrentes de pacotes.

---

## 3. Arquitetura da Pipeline

O diagrama abaixo ilustra o fluxo de execução paralela dos jobs acionados pelos gatilhos do GitHub Actions:

```
                   ┌───────────────────────────────────────────────┐
                   │   Evento GitHub (Push ou Pull Request: main)   │
                   └───────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                             │
                    ▼                                             ▼
     ┌─────────────────────────────┐               ┌─────────────────────────────┐
     │  Workflow: Lint & Typecheck │               │       Workflow: Tests       │
     │      (`lint.yml`)           │               │        (`test.yml`)         │
     └──────────────┬──────────────┘               └──────────────┬──────────────┘
                    │                                             │
         ┌──────────┴──────────┐             ┌────────────┬───────┴─────┬────────────┐
         │                     │             │            │             │            │
         ▼                     ▼             ▼            ▼             ▼            ▼
   ┌───────────┐         ┌───────────┐ ┌───────────┐┌───────────┐ ┌───────────┐┌───────────┐
   │ Job:      │         │ Job:      │ │ Job:      ││ Job:      │ │ Job:      ││ Job:      │
   │ lint      │         │ typecheck │ │unit-tests ││integration│ │ e2e-tests ││ coverage  │
   │           │         │           │ │           ││ -tests    │ │           ││ (>= 80%)  │
   │ (ESLint)  │         │ (tsc)     │ │ (vitest)  ││ (vitest)  │ │ (vitest)  ││ (vitest)  │
   └───────────┘         └───────────┘ └───────────┘└───────────┘ └───────────┘└─────┬─────┘
                                                                                     │
                                                                                     ▼
                                                                               ┌───────────┐
                                                                               │ Upload de │
                                                                               │ Artefato  │
                                                                               │(coverage/)│
                                                                               └───────────┘
```

---

## 4. Detalhamento dos Jobs e Quality Gates

### 4.1. Workflow: Lint & Typecheck (`lint.yml`)

Responsável pela saúde sintática e semântica do código sem executar a aplicação:

#### A. Job `lint` (ESLint)

- **Comando:** `npm run lint` (`eslint "{src,apps,libs,test}/**/*.ts" --fix`)
- **Objetivo:** Verifica conformidade com as regras de estilo de código, convenções de Clean Code, imports não utilizados e integração com o Prettier.
- **Critério de Falha:** Qualquer erro de sintaxe, variável não utilizada ou violação de formatação não corrigida interrompe o job.

#### B. Job `typecheck` (TypeScript Check)

- **Comando:** `npx tsc --noEmit`
- **Objetivo:** Executa o compilador TypeScript em modo de verificação estrita sem gerar arquivos de build em disco.
- **Por que é essencial?** Ferramentas como o SWC realizam transpilação rápida mas ignoram a verificação de tipos em tempo de execução de testes. O `tsc --noEmit` garante integridade completa de contratos, tipagens e generics no ecossistema NestJS.

---

### 4.2. Workflow: Tests (`test.yml`)

Executa as baterias de testes automatizados com base no **Vitest** e **SWC** (`unplugin-swc`):

#### A. Job `unit-tests` (Testes Unitários)

- **Comando:** `npm run test:unit` (`vitest run test/unit`)
- **Objetivo:** Valida isoladamente a lógica de domínio, casos de uso (`BuscarCepUseCase`), estratégias de fallback, providers externos com mocks e o mecanismo de cache em memória (`LruCacheProvider`).

#### B. Job `integration-tests` (Testes de Integração)

- **Comando:** `npm run test:integration` (`vitest run test/integration`)
- **Objetivo:** Garante que os módulos do NestJS resolvem corretamente as injeções de dependência, tokens customizados (`CACHE_PROVIDER`, `CEP_PROVIDERS`) e a comunicação com componentes de infraestrutura.

#### C. Job `e2e-tests` (Testes End-to-End)

- **Comando:** `npm run test:e2e` (`vitest run test/e2e`)
- **Objetivo:** Sobe uma instância completa da aplicação HTTP usando `supertest` e valida o ciclo de vida da requisição na rota `GET /cep/:cep`, incluindo headers `X-Cache`, interceptors, pipes Zod e respostas reais de sucesso e contingência.

#### D. Job `coverage` (Cobertura e Relatório)

- **Comando:** `npm run test:coverage` (`vitest run --coverage`)
- **Limiares Mínimos (Thresholds do `vitest.config.ts`):**
  - Linhas (_Lines_): **>= 80%**
  - Funções (_Functions_): **>= 80%**
  - Ramificações (_Branches_): **>= 80%**
  - Declarações (_Statements_): **>= 80%**
- **Upload de Artefatos:** Utiliza `actions/upload-artifact@v4` para disponibilizar o relatório de cobertura (`coverage/`) para download diretamente na interface do GitHub Actions.
  - A diretiva `if: always()` assegura que o relatório seja coletado mesmo se o job falhar, facilitando o diagnóstico das linhas que deixaram de ser cobertas.

---

## 5. Performance e Otimizações Adotadas

A pipeline foi otimizada para ser concluída rapidamente, evitando gargalos no fluxo de entrega contínua:

1. **Execução Concorrente (Paralela):**
   - Os jobs não possuem dependências sequenciais (`needs: [...]`). Dessa forma, no GitHub Actions, os jobs de Lint, Typecheck, Unit, Integration, E2E e Coverage sobem em runners paralelos simultaneamente.
2. **Cache de Módulos Node (`npm`):**
   - A configuração `cache: 'npm'` do `actions/setup-node@v4` reutiliza a pasta de cache global do npm entre execuções quando o `package-lock.json` não sofre alterações, reduzindo drasticamente o tempo de download.
3. **Vitest + SWC:**
   - A utilização do Vitest com SWC dispensa a sobrecarga tradicional de compilação do Jest/ts-jest, executando dezenas de testes em frações de segundos.

---

## 6. Matriz de Governança e Quality Gates

| Etapa          | Job                 | Comando                    | Limiar / Critério                           | Bloqueia Merge? |
| :------------- | :------------------ | :------------------------- | :------------------------------------------ | :-------------: |
| **Estilo**     | `lint`              | `npm run lint`             | 0 erros e 0 warnings graves                 |       Sim       |
| **Tipagem**    | `typecheck`         | `npx tsc --noEmit`         | 0 erros de tipo TypeScript                  |       Sim       |
| **Unidade**    | `unit-tests`        | `npm run test:unit`        | 100% de testes unitários passando           |       Sim       |
| **Integração** | `integration-tests` | `npm run test:integration` | 100% de testes de integração passando       |       Sim       |
| **E2E**        | `e2e-tests`         | `npm run test:e2e`         | 100% de testes E2E passando                 |       Sim       |
| **Cobertura**  | `coverage`          | `npm run test:coverage`    | Cobertura total >= 80% em todas as métricas |       Sim       |

---

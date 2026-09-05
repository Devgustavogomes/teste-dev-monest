# Pipeline de Integração Contínua (CI)

Este documento descreve a arquitetura, os estágios de validação e os *quality gates* das pipelines de **Integração Contínua (CI)** configuradas via **GitHub Actions**.

---

## 1. Visão Geral

- **Gatilhos:** Execução automática em todo `pull_request` e `push` direcionados à branch `main`.
- **Paralelismo Total:** Workflows e jobs independentes executam concorrentemente, acelerando o tempo de resposta (*time-to-feedback*).
- **Determinismo:** Ambientes limpos em `ubuntu-latest` com `npm ci` e cache automático de dependências.

---

## 2. Estrutura dos Workflows

A automação é dividida em dois workflows no diretório `.github/workflows/`:

```
               ┌───────────────────────────────────────────────┐
               │    Evento GitHub (Push ou Pull Request: main) │
               └───────────────────────┬───────────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                │                                             │
                ▼                                             ▼
 ┌─────────────────────────────┐               ┌─────────────────────────────┐
 │ Workflow: Lint & Typecheck  │               │       Workflow: Tests       │
 │        (`lint.yml`)         │               │        (`test.yml`)         │
 └──────────────┬──────────────┘               └──────────────┬──────────────┘
                │                                             │
     ┌──────────┴──────────┐             ┌────────────┬───────┴─────┬────────────┐
     ▼                     ▼             ▼            ▼             ▼            ▼
┌───────────┐        ┌───────────┐ ┌───────────┐┌───────────┐ ┌───────────┐┌───────────┐
│ Job: lint │        │ Job:      │ │ Job:      ││ Job:      │ │ Job:      ││ Job:      │
│ (ESLint)  │        │ typecheck │ │unit-tests ││integration│ │ e2e-tests ││ coverage  │
│           │        │ (tsc)     │ │           ││ -tests    │ │           ││ (>= 80%)  │
└───────────┘        └───────────┘ └───────────┘└───────────┘ └───────────┘└─────┬─────┘
                                                                                 │
                                                                                 ▼
                                                                           ┌───────────┐
                                                                           │ Upload de │
                                                                           │ Artefato  │
                                                                           │(coverage/)│
                                                                           └───────────┘
```

---

## 3. Matriz de Quality Gates

Qualquer falha em qualquer etapa bloqueia a integração do código (*merge*):

| Etapa | Job | Comando | Critério de Aprovação | Bloqueia Merge? |
| :--- | :--- | :--- | :--- | :---: |
| **Estilo** | `lint` | `npm run lint` | 0 erros ESLint / Prettier. | Sim |
| **Tipagem** | `typecheck` | `npx tsc --noEmit` | 0 erros de tipagem estrita TypeScript. | Sim |
| **Unidade** | `unit-tests` | `npm run test:unit` | 100% dos testes unitários passando. | Sim |
| **Integração** | `integration-tests` | `npm run test:integration` | 100% dos testes de integração passando. | Sim |
| **E2E** | `e2e-tests` | `npm run test:e2e` | 100% dos testes ponta a ponta passando. | Sim |
| **Cobertura** | `coverage` | `npm run test:coverage` | Cobertura total >= 80% (linhas, funções, branches, statements). | Sim |

---

## 4. Otimizações de Performance

1. **Sem Dependências em Cadeia:** Os jobs não utilizam `needs: [...]`, executando simultaneamente em runners dedicados.
2. **Vitest + SWC:** Execução de testes extremamente rápida com compilação sob demanda via Rust (`unplugin-swc`).
3. **Cache de Dependências:** `actions/setup-node@v4` com `cache: 'npm'` evita download redundante de pacotes quando o `package-lock.json` não for alterado.
4. **Exportação de Relatório:** O job de cobertura publica o artefato `coverage/` para download via `actions/upload-artifact@v4` com `if: always()`, facilitando o diagnóstico mesmo em caso de quebra de limiar.

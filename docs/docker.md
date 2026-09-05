# Guia de Containerização Docker

Este documento descreve a arquitetura da imagem Docker multi-stage e as instruções para execução via **Docker Compose** e **Docker CLI**.

---

## 1. Visão Geral & Boas Práticas

- **Multi-Stage Build:** Separação estrita entre estágios de instalação, compilação e execução, reduzindo a imagem de ~1.2GB para **menos de 180MB**.
- **Segurança (Não-Root):** Execução com usuário sem privilégios (`USER node` e `--chown=node:node`), mitigando riscos de escape de container.
- **Base Mínima (`node:24-alpine`):** Menor número de vulnerabilidades conhecidas (CVEs) e downloads mais rápidos.
- **Healthcheck Nativo:** Monitoramento periódico via `wget --spider http://localhost:${PORT:-3000}/health || exit 1`.

---

## 2. Arquitetura Multi-Stage do Dockerfile

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ESTÁGIO 1: deps                                │
│                       FROM node:24-alpine AS deps                           │
│  - Copia package.json e package-lock.json                                   │
│  - Instala dependências estritas via 'npm ci'                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ESTÁGIO 2: builder                               │
│                      FROM node:24-alpine AS builder                         │
│  - Copia código-fonte                                                       │
│  - Compila TypeScript ('npm run build' -> dist/)                           │
│  - Remove devDependencies ('npm prune --omit=dev')                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ESTÁGIO 3: runner                                │
│                       FROM node:24-alpine AS runner                         │
│  - Imagem limpa com NODE_ENV=production                                     │
│  - Copia apenas dist/ e node_modules/ de produção                           │
│  - Define 'USER node' (não-root)                                            │
│  - Configura HEALTHCHECK ativo via wget                                     │
│  - Executa 'CMD ["node", "dist/main.js"]'                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Execução com Docker Compose (Recomendado)

O arquivo [docker-compose.yml](file:///c:/Users/gustavo/projetos/teste-dev-monest/docker-compose.yml) orquestra a aplicação:

```bash
# Subir aplicação em segundo plano com build
docker compose up -d --build

# Acompanhar logs em tempo real
docker compose logs -f

# Verificar status e healthcheck (deve exibir: healthy)
docker compose ps

# Parar os containers
docker compose down
```

---

## 4. Execução com Docker CLI (Manual)

```bash
# 1. Build da imagem
docker build -t api-cep .

# 2. Executar o container
docker run -d --name api-cep -p 3000:3000 --env-file .env api-cep

# 3. Verificar status e logs
docker ps
docker logs -f api-cep

# 4. Parar e remover
docker stop api-cep && docker rm api-cep
```

---

## 5. Endpoints de Verificação

Com a aplicação ativa na porta `3000`:
- **Documentação Swagger:** `http://localhost:3000/api/docs`
- **Health Check:** `http://localhost:3000/health`
- **Consulta de CEP:** `http://localhost:3000/cep/01001000`

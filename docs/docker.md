# Guia de Containerização Docker

Este documento descreve a arquitetura da imagem Docker multi-stage e as instruções para execução via **Docker Compose** e **Docker CLI**.

---

## 1. Visão Geral & Boas Práticas

- **Multi-Stage Build:** Separação estrita entre estágios de instalação, compilação e execução, reduzindo a imagem de ~1.2GB para **menos de 180MB**.
- **Segurança (Não-Root):** Execução com usuário sem privilégios (`USER node` e `--chown=node:node`), mitigando riscos de escape de container.
- **Base Mínima (`node:24-alpine`):** Menor número de vulnerabilidades conhecidas (CVEs) e downloads mais rápidos.
- **Healthcheck Nativo:** Monitoramento periódico via `wget --spider http://localhost:${PORT:-3000}/health || exit 1`.

---

## 2. Decisões Arquiteturais (Os Porquês)

### 2.1. Por que Multi-Stage Build?

Uma aplicação TypeScript precisa de ferramentas de compilação (`typescript`, `@nestjs/cli`, linters, tipos), mas **nenhuma delas deve ir para produção**:

- **Estágio `prod-deps`:** Instala exclusivamente as dependências de produção (`npm ci --omit=dev`), aproveitando o cache de camadas do Docker se o `package.json` não mudar.
- **Estágio `builder`:** Instala ferramentas de desenvolvimento (`npm ci`) e compila o TypeScript para `dist/` (`npm run build`).
- **Estágio `runner`:** Imagem final contendo apenas os artefatos compilados (`dist/`) e as dependências de produção (`node_modules/` do `prod-deps`). A imagem resultante cai de **~1.2 GB para menos de ~180 MB**.

### 2.2. Por que `node:24-alpine`?

O Alpine Linux é uma distribuição minimalista voltada para segurança:

- Reduz drasticamente a quantidade de vulnerabilidades conhecidas (CVEs) em comparação com imagens completas baseadas em Debian/Ubuntu.
- Downloads e inicialização de containers muito mais rápidos em pipelines de CI/CD e ambientes de nuvem.

### 2.3. Por que Usuário Não-Root (`USER node` e `--chown=node:node`)?

Por padrão, containers Docker rodam como `root`. Se a aplicação sofrer uma invasão (RCE ou vulnerabilidade em biblioteca externa), o invasor ganha privilégios de root dentro do container e pode tentar escapar para o host.

- Executar como `USER node` limita o raio de explosão: o processo não pode instalar pacotes, alterar arquivos de sistema nem acessar recursos restritos.
- O `--chown=node:node` atribui a posse de `dist/` e `node_modules/` ao usuário `node`, evitando erros de permissão (`EACCES`).

### 2.4. Por que Healthcheck via `wget --spider`?

Container rodando não significa container saudável: a aplicação pode ter travado o Event Loop ou sofrido um deadlock.

- O comando `wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1` consulta periodicamente a rota de saúde.
- O `--spider` apenas valida o status HTTP `200 OK` sem transferir arquivos.
- O `wget` já vem nativamente no Alpine (via BusyBox), dispensando a instalação de pacotes adicionais como `curl`.

---

## 3. Arquitetura do Dockerfile

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ESTÁGIO 1: prod-deps                               │
│                   FROM node:24-alpine AS prod-deps                          │
│  - Copia package.json e package-lock.json                                   │
│  - Instala apenas dependências de produção via 'npm ci --omit=dev'          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ESTÁGIO 2: builder                               │
│                    FROM node:24-alpine AS builder                           │
│  - Copia package.json, package-lock.json e código-fonte                     │
│  - Instala dependências de compilação via 'npm ci'                          │
│  - Executa 'npm run build' (compilação TS -> dist/)                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ESTÁGIO 3: runner                                │
│                     FROM node:24-alpine AS runner                           │
│  - Imagem limpa e enxuta                                                    │
│  - Define NODE_ENV=production                                               │
│  - Copia node_modules/ de 'prod-deps' e dist/ de 'builder'                  │
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

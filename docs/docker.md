# Guia e Arquitetura de Containerização Docker

Este documento descreve a arquitetura, as decisões técnicas e as instruções operacionais para execução da **API de Consulta de CEP** com **Docker** e **Docker Compose**.

---

## 1. Visão Geral e Motivação

Containerizar uma aplicação Node.js para produção exige mais do que apenas um `npm start` empacotado. Esta implementação foi desenhada sob quatro pilares fundamentais:

* **Segurança em Profundidade:** Zero privilégios de root em tempo de execução e menor superfície de ataque possível.
* **Imutabilidade e Tamanho Mínimo:** Imagem final contendo apenas os artefatos compilados em JavaScript e dependências de produção.
* **Observabilidade Ativa:** Detecção automática de travamentos e falhas de processo através de healthcheck nativo.
* **Padronização:** Alinhamento estrito com a versão **Node.js 24**, garantindo paridade entre desenvolvimento local, CI e produção.

---

## 2. Decisões Arquiteturais (Os Porquês)

### 2.1. Por que Multi-Stage Build?
Uma aplicação TypeScript precisa de ferramentas pesadas para ser construída (`typescript`, `@nestjs/cli`, tipos `@types/*`, linters), mas **nenhuma delas deve ir para produção**:
* **Estágio `deps`:** Baixa todas as dependências (`npm ci`) isoladamente, aproveitando o cache de camadas do Docker se o `package.json` não mudar.
* **Estágio `builder`:** Compila o TypeScript para `dist/` e executa `npm prune --omit=dev`, eliminando centenas de megabytes de ferramentas de build.
* **Estágio `runner`:** Copia apenas o código transpilado e as dependências de produção. A imagem resultante cai de **~1.2 GB para menos de ~180 MB**.

### 2.2. Por que `node:24-alpine`?
O Alpine Linux é uma distribuição minimalista voltada para segurança:
* Reduz drasticamente a quantidade de vulnerabilidades conhecidas (CVEs) em comparação com imagens completas baseadas em Debian/Ubuntu.
* Downloads e inicialização de containers muito mais rápidos em pipelines de CI/CD e ambientes de nuvem.

### 2.3. Por que Usuário Não-Root (`USER node` e `--chown=node:node`)?
Por padrão, containers Docker rodam como `root`. Se a aplicação sofrer uma invasão (RCE ou vulnerabilidade em biblioteca externa), o invasor ganha privilégios de root dentro do container e pode tentar escapar para o host.
* Executar como `USER node` limita o raio de explosão: o processo não pode instalar pacotes, alterar arquivos de sistema nem acessar recursos restritos.
* O `--chown=node:node` atribui a posse de `dist/` e `node_modules/` ao usuário `node`, evitando erros de permissão (`EACCES`).

### 2.4. Por que Healthcheck via `wget --spider`?
Container rodando não significa container saudável: a aplicação pode ter travado o Event Loop ou sofrido um deadlock.
* O comando `wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1` consulta periodicamente a rota de saúde.
* O `--spider` apenas valida o status HTTP `200 OK` sem transferir arquivos.
* O `wget` já vem nativamente no Alpine (via BusyBox), dispensando a instalação de pacotes adicionais como `curl`.

---

## 3. Arquitetura do Dockerfile

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ESTÁGIO 1: deps                                │
│                     FROM node:24-alpine AS deps                             │
│  - Copia package.json e package-lock.json                                   │
│  - Executa 'npm ci' (instala todas as dependências via lockfile)            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ESTÁGIO 2: builder                               │
│                    FROM node:24-alpine AS builder                           │
│  - Copia o código-fonte                                                     │
│  - Executa 'npm run build' (compilação TS -> dist/)                         │
│  - Executa 'npm prune --omit=dev' (remove devDependencies de node_modules)  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ESTÁGIO 3: runner                                │
│                     FROM node:24-alpine AS runner                           │
│  - Imagem limpa e enxuta                                                    │
│  - Define NODE_ENV=production                                               │
│  - Copia apenas dist/ e node_modules/ de produção (--chown=node:node)       │
│  - Define 'USER node' (não-root)                                            │
│  - Configura HEALTHCHECK via wget                                           │
│  - Executa 'CMD ["node", "dist/main.js"]'                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Como Rodar com Docker Compose (Recomendado)

O [docker-compose.yml](file:///c:/Users/gustavo/projetos/teste-dev-monest/docker-compose.yml) orquestra a execução da aplicação pronta para produção.

### Subir a aplicação em segundo plano
```bash
docker compose up -d --build
```

### Acompanhar logs
```bash
docker compose logs -f
```

### Verificar status de saúde (Healthcheck)
```bash
docker compose ps
```
> O status deve exibir `Up (healthy)`.

### Parar a aplicação
```bash
docker compose down
```

---

## 5. Como Rodar com Docker CLI (Standalone)

Caso prefira compilar e rodar a imagem manualmente sem o Compose:

```bash
# 1. Build da imagem
docker build -t api-cep .

# 2. Executar o container
docker run -d \
  --name api-cep \
  -p 3000:3000 \
  --env-file .env \
  api-cep

# 3. Verificar container e logs
docker ps
docker logs -f api-cep

# 4. Parar e remover
docker stop api-cep && docker rm api-cep
```

---

## 6. Endpoints Principais

Com a aplicação em execução na porta `3000`:
* **Documentação Swagger:** `http://localhost:3000/api/docs`
* **Health Check:** `http://localhost:3000/health`
* **Consulta de CEP:** `http://localhost:3000/cep/01001000`

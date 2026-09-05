# Getting Started

Guia rápido para configurar e rodar o projeto localmente ou via Docker.

---

## 1. Pré-requisitos

- **Node.js**: `24.x` (ou `20.x+`)
- **Docker & Docker Compose** (opcional)

---

## 2. Instalação e Configuração

```bash
# Clone e entre no repositório
git clone https://github.com/Devgustavogomes/teste-dev-monest.git
cd teste-dev-monest

# Instale as dependências
npm install

# Crie o arquivo de ambiente a partir do exemplo
cp .env.example .env
```

---

## 3. Executando a Aplicação

### Localmente (Desenvolvimento)

```bash
npm run start:dev
```

### Via Docker Compose

```bash
docker compose up --build
```

A API estará disponível em: **`http://localhost:3000`**

---

## 4. Endpoints Principais

| Endpoint | Método | Descrição | Exemplo |
| :--- | :---: | :--- | :--- |
| `/api/docs` | `GET` | Documentação interativa (Swagger UI) | [http://localhost:3000/api/docs](http://localhost:3000/api/docs) |
| `/cep/:cep` | `GET` | Consulta CEP (com ou sem hífen) | `curl http://localhost:3000/cep/01001000` |
| `/health` | `GET` | Health check da aplicação | `curl http://localhost:3000/health` |

> As respostas da rota `/cep/:cep` incluem o cabeçalho `X-Cache: HIT` ou `X-Cache: MISS`.

---

## 5. Testes

```bash
# Executa todos os testes
npm test

# Cobertura de código
npm run test:coverage

# Linter
npm run lint
```

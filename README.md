# Medica Certo

Webapp para cuidadores administrarem medicamentos a um ou mais pacientes.  
Produção alvo: **`medica-certo.altamir.dev`** (VPS Hostinger / Traefik).

Documentação: `CONTEXT.md`, `docs/prd.md`, `docs/design.md`, `docs/roadmap.md`.

## Pré-requisitos

- Node.js ≥ 22
- Docker (Postgres local)

## Desenvolvimento local (PR1)

```bash
./start.sh          # Postgres (Docker) + Fastify (:8080) + Vite (:5173)
./start.sh --prod   # build da web; Fastify serve API + SPA na :8080
```

Equivalente manual:

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run dev
```

- UI: http://127.0.0.1:5173 (`WEB_PORT` no `.env` se a porta estiver ocupada)  
- API: http://127.0.0.1:8080/api/health  

O Vite faz proxy de `/api` para o Fastify. Ctrl+C no `start.sh` para API/web; o Postgres no Docker permanece (`docker compose stop postgres` se quiser derrubar).

## Stack (ADR 001)

Node 22 ESM · Fastify · PostgreSQL (`pg`) · Vite/React/TS · UI com CSS variables · deploy Docker 1 réplica.

## Auth (PR2 / ADR 003)

- Cookie `mc_session` (HttpOnly, SameSite=Lax; `Secure` em produção)
- Primeiro cuidador: tela **Criar cuidador** em `/login`, ou seed `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` no `.env`
- Depois do primeiro cadastro, `POST /api/auth/register` responde `409 BOOTSTRAP_CLOSED`

## Pacientes (PR3 / R2)

- Rotas: `GET/POST /api/patients`, `GET/PUT/DELETE /api/patients/:id`
- UI: `/pacientes`, `/pacientes/novo`, `/pacientes/:id`
- Janela de sono padrão `22:00–07:00`; `DELETE` responde `409 CONFLICT` se houver tratamento ativo (quando a tabela existir)

## Próximos passos

1. PR4 — CRUD de medicamentos + busca  
2. Deploy na VPS com labels Traefik já esboçadas no Compose (`Host(\`medica-certo.altamir.dev\`)`)

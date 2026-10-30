# Medica Certo

Webapp para cuidadores administrarem medicamentos a um ou mais pacientes.  
Produção alvo: **`medica-certo.altamir.dev`** (VPS Hostinger / Traefik).

Documentação: `CONTEXT.md`, `docs/prd.md`, `docs/design.md`, `docs/roadmap.md`.

## Pré-requisitos

- Node.js ≥ 22
- Docker (Postgres local)

## Desenvolvimento local (PR1)

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run dev
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8080/api/health  

O Vite faz proxy de `/api` para o Fastify.

## Stack (ADR 001)

Node 22 ESM · Fastify · PostgreSQL (`pg`) · Vite/React/TS · UI com CSS variables · deploy Docker 1 réplica.

## Próximos passos

1. PR2 — Auth do cuidador  
2. Deploy na VPS com labels Traefik já esboçadas no Compose (`Host(\`medica-certo.altamir.dev\`)`)

# ADR 001 — Stack do Medica Certo

| Campo | Valor |
|---|---|
| Status | Aceito |
| Data | 2026-10-30 |
| Decisores | Design MVP (`docs/design.md` KD7, KD19, KD20) |

## Contexto

Precisamos de um monólito modular para o cuidador administrar pacientes, medicamentos, tratamentos, grade de doses e alarmes (PWA). O volume é doméstico; a ops alvo é a VPS Hostinger (`alt-vps`) atrás do Traefik, no mesmo padrão de `zap-resumos`.

## Decisão

| Camada | Escolha |
|---|---|
| Runtime | Node.js ≥ 22, ESM |
| API | Fastify + JSON REST |
| Persistência | PostgreSQL 16 + driver `pg` |
| Migrações | SQL versionado em `server/migrations/` (a partir da PR2) |
| Frontend | Vite + React + TypeScript |
| UI | Tokens e padrões via **CSS variables** (`:root`); sem biblioteca de UI externa no MVP |
| Auth (PR2+) | E-mail/senha + sessão cookie `HttpOnly` |
| Notificações (PR8+) | PWA + `web-push` (VAPID) |
| Deploy | Docker Compose, **1 réplica** de app, host **`medica-certo.altamir.dev`** |

## Consequências

- Um único processo de app (API + jobs leves); scheduler in-process exige `replicas: 1`.
- Casco visual do portal (menu 90px + header + main) composto no Vite/React; Tag variants só `primary` \| `secondary` \| `success` \| `error` \| `disabled`.
- Separação `server/` e `web/` no monorepo npm workspaces; em produção o Fastify serve `web/dist`.
- Desenvolvimento local: Postgres via Compose; Vite em `:5173` com proxy `/api` → Fastify `:8080`.

## Alternativas rejeitadas

- Next.js fullstack — acoplamento e SW/PWA menos previsível para o padrão já validado.
- Biblioteca de UI de outro repositório — zero acoplamento no MVP (KD19).
- `node:http` cru (como zap-resumos) — superfície REST maior justifica Fastify.
- `postgres.js` — manter `pg` alinhado ao prior art.

## Referências

- `docs/design.md` — Overview, Key Decisions KD7–KD21, PR Plan PR1


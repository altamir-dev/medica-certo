# ADR 003 — Auth por e-mail/senha e sessão cookie

| Campo | Valor |
|---|---|
| Status | Aceito |
| Data | 2026-10-30 |
| Decisores | Design MVP (`docs/design.md` KD1, KD12) |

## Contexto

O MVP tem um cuidador self-hosted. Não há SMTP no dia 1, então magic link e OAuth ficam de fora. Precisamos de login, logout, sessão durável e isolamento por `caregiver_id` desde a primeira rota de domínio.

## Decisão

| Tema | Escolha |
|---|---|
| Credencial | E-mail (`citext`) + senha |
| Hash | Argon2id (`argon2` npm) |
| Sessão | Cookie `mc_session` opaco, `HttpOnly`, `SameSite=Lax`, `Secure` em produção |
| Persistência | Tabela `sessions` (`id`, `caregiver_id`, `expires_at`) |
| TTL | 30 dias, renovado em atividade (sliding) |
| Rotação | Novo `id` a cada login; sessão anterior do mesmo login não é reutilizada |
| Bootstrap | `POST /api/auth/register` só com zero cuidadores; opcional seed `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` / `BOOTSTRAP_NAME` no boot |
| Rate limit | 10 tentativas / minuto por IP+e-mail no login (e no register) |
| Rotas públicas | `/api/health`, `/api/auth/login`, `/api/auth/register` |

## Consequências

- Toda query de domínio filtra por `caregiver_id` da sessão (PR3+).
- Sem signup público: após o primeiro cuidador, register responde `409 BOOTSTRAP_CLOSED`.
- Em localhost `Secure` fica desligado (`COOKIE_SECURE=0` / `NODE_ENV=development`) para o cookie funcionar em HTTP.
- Força bruta é mitigada pelo rate limit in-process (válido com `replicas: 1`).

## Alternativas rejeitadas

- Magic link — exige SMTP.
- JWT só no cliente — revogação e TTL sliding mais fracos para o MVP.
- OAuth / IdP externo — overhead e conta de terceiro para um cuidador doméstico.

## Referências

- `docs/design.md` — Auth, API Auth, KD1, KD12, PR2
- `server/auth.mjs`, `server/routes/auth.mjs`, `server/migrations/001_init.sql`

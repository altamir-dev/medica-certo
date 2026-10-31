#!/usr/bin/env bash
# Deploy idempotente do Medica Certo em /docker/medica-certo.
#
# Token do GHCR no stdin (não aparece na linha de comando):
#   printf '%s' "$TOKEN" | \
#     MEDICA_CERTO_IMAGE_TAG=<sha40> GHCR_USER=<github-user> \
#     ./deploy.sh
#
# Lê .env no mesmo diretório (não versionado). Grava image.env com a imagem
# e o SHA. Sobe o Postgres, aplica as migrações SQL, recria o app e sai com
# erro se /api/health não responder "status":"ok".
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$ROOT"

if [[ "$ROOT" != "/docker/medica-certo" ]]; then
  echo "deploy.sh tem de correr em /docker/medica-certo (está em ${ROOT})." >&2
  exit 1
fi

info() { printf '▸ %s\n' "$*"; }

ghcr_logged_in=0
cleanup() {
  if [[ "$ghcr_logged_in" -eq 1 ]]; then
    docker logout ghcr.io >/dev/null 2>&1 || true
    ghcr_logged_in=0
  fi
}
trap cleanup EXIT

# Last assignment wins, same as a quick read. Strips one layer of quotes.
# Result is stored in ENV_VALUE (not exported). Caller must unset it.
read_env_value() {
  local key="$1" line value
  line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ ${#value} -ge 2 && ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi
  ENV_VALUE="$value"
}

if [[ ! -f docker-compose.yml ]]; then
  echo "Falta /docker/medica-certo/docker-compose.yml." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "Falta /docker/medica-certo/.env. Use deploy/env.vps.example como modelo e chmod 600." >&2
  exit 1
fi

env_mode="$(stat -c '%a' .env)"
if [[ "$env_mode" != "600" && "$env_mode" != "400" ]]; then
  echo "Aviso: .env está com modo ${env_mode}. Rode: chmod 600 /docker/medica-certo/.env" >&2
fi

read_env_value POSTGRES_PASSWORD
if [[ -z "${ENV_VALUE}" ]]; then
  echo "Defina POSTGRES_PASSWORD em /docker/medica-certo/.env (ausente ou vazio)." >&2
  exit 1
fi
# The value is interpolated into DATABASE_URL. Reject characters that split the URL.
if [[ "${ENV_VALUE}" =~ [^A-Za-z0-9._-] ]]; then
  echo "POSTGRES_PASSWORD só pode ter letras, dígitos e ._- (sem espaço, \$, @, :, /, #, ? ou %)." >&2
  exit 1
fi
unset ENV_VALUE

read_env_value TRAEFIK_NETWORK
if [[ -z "${ENV_VALUE}" ]]; then
  echo "Defina TRAEFIK_NETWORK em /docker/medica-certo/.env (ausente ou vazio)." >&2
  exit 1
fi
if [[ ! "${ENV_VALUE}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "TRAEFIK_NETWORK inválido. Use o nome da rede Docker (letras, dígitos, ._-)." >&2
  exit 1
fi
unset ENV_VALUE

MEDICA_CERTO_IMAGE="${MEDICA_CERTO_IMAGE:-ghcr.io/altamir-dev/medica-certo}"
: "${MEDICA_CERTO_IMAGE_TAG:?Defina MEDICA_CERTO_IMAGE_TAG}"
: "${GHCR_USER:?Defina GHCR_USER}"

if [[ ! "$MEDICA_CERTO_IMAGE_TAG" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "MEDICA_CERTO_IMAGE_TAG tem de ser o SHA completo (40 hex)." >&2
  exit 1
fi
if [[ ! "$MEDICA_CERTO_IMAGE" =~ ^ghcr\.io/[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
  echo "MEDICA_CERTO_IMAGE inválida." >&2
  exit 1
fi
if [[ ! "$GHCR_USER" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "GHCR_USER inválido." >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "docker não encontrado." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "docker compose (plugin v2) não encontrado." >&2
  exit 1
}

ghcr_token="$(cat)"
ghcr_token="${ghcr_token//$'\r'/}"
ghcr_token="${ghcr_token//$'\n'/}"
if [[ -z "$ghcr_token" ]]; then
  echo "Token GHCR ausente no stdin." >&2
  exit 1
fi

printf 'MEDICA_CERTO_IMAGE=%s\nMEDICA_CERTO_IMAGE_TAG=%s\n' \
  "$MEDICA_CERTO_IMAGE" "$MEDICA_CERTO_IMAGE_TAG" >image.env
chmod 644 image.env

compose() {
  docker compose --ansi never --env-file .env --env-file image.env "$@"
}

mkdir -p /docker/medica-certo/data/postgres /docker/medica-certo/data/med-photos

info "Login no GHCR…"
printf '%s' "$ghcr_token" | docker login ghcr.io --username "$GHCR_USER" --password-stdin
unset ghcr_token
ghcr_logged_in=1

info "Pull ${MEDICA_CERTO_IMAGE}:${MEDICA_CERTO_IMAGE_TAG}…"
compose pull --policy always
docker logout ghcr.io >/dev/null 2>&1 || true
ghcr_logged_in=0

info "Ajustando dono de data/med-photos (uid 1000 da imagem)…"
docker run --rm --user 0 --entrypoint chown \
  -v /docker/medica-certo/data/med-photos:/data \
  "${MEDICA_CERTO_IMAGE}:${MEDICA_CERTO_IMAGE_TAG}" \
  -R 1000:1000 /data

info "Subindo Postgres…"
compose up -d postgres
pg_ready=0
for _ in $(seq 1 30); do
  if compose exec -T postgres pg_isready -U medica -d medica_certo >/dev/null 2>&1; then
    pg_ready=1
    break
  fi
  sleep 2
done
if [[ "$pg_ready" != "1" ]]; then
  echo "Postgres não ficou pronto." >&2
  compose logs --tail=80 postgres >&2 || true
  exit 1
fi

info "Aplicando migrações…"
compose --profile tools run --rm --no-deps migrate

info "Subindo o app…"
compose up -d

info "Aguardando /api/health…"
health_body=""
healthy=0
for _ in $(seq 1 40); do
  health_body="$(compose exec -T app wget -qO- -T 3 http://127.0.0.1:8080/api/health 2>/dev/null || true)"
  if [[ "$health_body" == *'"status":"ok"'* ]]; then
    healthy=1
    break
  fi
  sleep 3
done

if [[ "$healthy" != "1" ]]; then
  echo "App não ficou saudável. Última resposta: ${health_body:-<vazia>}" >&2
  compose ps >&2 || true
  compose logs --tail=200 app >&2 || true
  exit 1
fi

printf '%s\n' "$health_body"
info "Deploy ok: ${MEDICA_CERTO_IMAGE}:${MEDICA_CERTO_IMAGE_TAG}"

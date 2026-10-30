#!/usr/bin/env bash
# Medica Certo — sobe Postgres (Docker), API e web com um comando.
#
#   ./start.sh          desenvolvimento: postgres + Fastify (:8080) + Vite (:5173)
#   ./start.sh --prod   build da web; Fastify serve API + SPA na :8080
#   ./start.sh --help
#
# Idempotente: pode rodar de novo. Ctrl+C para API/web (Postgres no Docker fica de pé).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MIN_NODE="22.0.0"
MODE="dev"
DEFAULT_API_PORT=8080
DEFAULT_WEB_PORT=5173

info() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --prod) MODE="prod" ;;
    --dev) MODE="dev" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "Opção desconhecida: $arg (use --help)." ;;
  esac
done

# Compares dotted versions: returns 0 when $1 >= $2.
version_ge() {
  local IFS=.
  local -a a b
  read -r -a a <<<"$1"
  read -r -a b <<<"$2"
  local i
  for i in 0 1 2; do
    local x="${a[i]:-0}" y="${b[i]:-0}"
    if ((10#$x > 10#$y)); then return 0; fi
    if ((10#$x < 10#$y)); then return 1; fi
  done
  return 0
}

# Reads KEY from .env without printing the file (values may be sensitive).
env_value() {
  local key="$1" line
  [[ -f .env ]] || return 0
  line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

# ---- 1. pré-requisitos ----
info "Verificando pré-requisitos…"

command -v node >/dev/null 2>&1 ||
  fail "Node não encontrado. Instale o Node ${MIN_NODE}+ (ex.: brew install node@22)."
NODE_VERSION="$(node -p 'process.versions.node')"
version_ge "$NODE_VERSION" "$MIN_NODE" ||
  fail "Node ${NODE_VERSION} é antigo. Precisa do Node ${MIN_NODE} ou mais novo."
ok "Node ${NODE_VERSION}"

command -v npm >/dev/null 2>&1 || fail "npm não encontrado."
ok "npm $(npm --version)"

command -v docker >/dev/null 2>&1 ||
  fail "Docker não encontrado. Instale o Docker Desktop (Postgres local)."
docker compose version >/dev/null 2>&1 ||
  fail "docker compose indisponível. Atualize o Docker Desktop."
ok "Docker Compose $(docker compose version --short 2>/dev/null || echo ok)"

# ---- 2. .env ----
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok "Criei o .env a partir do .env.example."
else
  ok ".env encontrado (conteúdo não exibido)"
fi

# Preferência: variável de ambiente > .env > default.
if [[ -z "${PORT:-}" ]]; then
  PORT="$(env_value PORT)"
fi
API_PORT="${PORT:-$DEFAULT_API_PORT}"

if [[ -z "${WEB_PORT:-}" ]]; then
  WEB_PORT="$(env_value WEB_PORT)"
fi
WEB_PORT="${WEB_PORT:-$DEFAULT_WEB_PORT}"

export PORT="$API_PORT"
export WEB_PORT

port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# ---- 3. dependências ----
info "Instalando dependências (npm install)…"
npm install --no-audit --no-fund
ok "Dependências ok"

# ---- 4. Postgres (Compose) ----
info "Subindo Postgres (docker compose up -d postgres)…"
docker compose up -d postgres

info "Aguardando Postgres saudável…"
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U medica -d medica_certo >/dev/null 2>&1; then
    ok "Postgres pronto"
    break
  fi
  sleep 1
done
docker compose exec -T postgres pg_isready -U medica -d medica_certo >/dev/null 2>&1 ||
  fail "Postgres não ficou pronto a tempo. Veja: docker compose logs postgres"

# ---- 5. build + start ----
if port_listening "$API_PORT"; then
  fail "Porta ${API_PORT} já em uso. Pare o processo (lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN) e rode de novo."
fi
if [[ "$MODE" == "dev" ]] && port_listening "$WEB_PORT"; then
  fail "Porta ${WEB_PORT} já em uso. Liberte-a ou defina WEB_PORT no .env / ambiente."
fi

if [[ "$MODE" == "prod" ]]; then
  info "Build da web…"
  npm run build
  export NODE_ENV=production
  CMD=(npm run start)
  URL="http://127.0.0.1:${API_PORT}"
else
  export NODE_ENV=development
  CMD=(npm run dev)
  URL="http://127.0.0.1:${WEB_PORT}"
fi

# Own process group for the children so Ctrl+C stops the whole tree.
set -m
"${CMD[@]}" &
CHILD=$!
set +m

# shellcheck disable=SC2329 # invoked by the traps below
stop() {
  trap - INT TERM EXIT
  if kill -0 "$CHILD" 2>/dev/null; then
    info "Parando API/web…"
    kill -TERM -- "-$CHILD" 2>/dev/null || kill -TERM "$CHILD" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$CHILD" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$CHILD" 2>/dev/null || true
  fi
  ok "API/web parados (Postgres no Docker continua; use: docker compose stop postgres)."
}
trap 'stop; exit 130' INT
trap 'stop; exit 143' TERM
trap stop EXIT

info "Aguardando API em 127.0.0.1:${API_PORT}…"
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  kill -0 "$CHILD" 2>/dev/null || fail "O processo parou durante a inicialização (veja as mensagens acima)."
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1 ||
  fail "A API não respondeu em http://127.0.0.1:${API_PORT}/api/health."

if [[ "$MODE" == "dev" ]]; then
  info "Aguardando Vite em 127.0.0.1:${WEB_PORT}…"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
      break
    fi
    kill -0 "$CHILD" 2>/dev/null || fail "O Vite parou durante a inicialização."
    sleep 0.5
  done
  curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1 ||
    fail "Vite não respondeu em http://127.0.0.1:${WEB_PORT}/ (porta ocupada? liberte a ${WEB_PORT})."
fi

echo
ok "Medica Certo no ar (${MODE}): ${URL}"
if [[ "$MODE" == "dev" ]]; then
  info "API http://127.0.0.1:${API_PORT}/api/health · web hot reload ${URL}"
else
  info "API + SPA em ${URL} (health: ${URL}/api/health)"
fi
info "Host alvo produção: medica-certo.altamir.dev"
info "Ctrl+C para parar API/web."
echo

set +e
wait "$CHILD"
STATUS=$?
set -e
exit "$STATUS"

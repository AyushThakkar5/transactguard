#!/usr/bin/env bash
#
# TransactGuard — start every service in dependency order, in one terminal.
#
#   ./dev.sh              start everything and stream a combined log
#   ./dev.sh --detach     start everything, print the summary, and exit
#   ./dev.sh stop         stop anything left running from a previous session
#   ./dev.sh status       report what is up without changing anything
#
# Ctrl-C shuts all five down cleanly. Individual logs land in logs/.
#
# Order matters and is enforced with real readiness checks rather than sleeps:
# Postgres and Redis must accept connections before the API opens its pool, the
# ML service must answer before the API forwards a scoring request to it, and
# the worker needs Redis for its queue. The frontend is last because it is the
# only one nothing else depends on.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

# Docker Desktop installs here but is not always on a non-interactive PATH.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
COMPOSE_FILE="$ROOT/docker-compose.yml"

API_URL="http://127.0.0.1:4000/api/v1/health"
ML_URL="http://127.0.0.1:8000/health"
WEB_URL="http://127.0.0.1:5173"

PIDS=()

# --- output -----------------------------------------------------------------
if [ -t 1 ]; then
  DIM=$'\033[2m'; BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  DIM=''; BOLD=''; GREEN=''; RED=''; YELLOW=''; RESET=''
fi

step() { printf "%s→%s %s\n" "$BOLD" "$RESET" "$1"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
die()  { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1"; exit 1; }

# --- helpers ----------------------------------------------------------------

port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }

port_busy() { [ -n "$(port_pids "$1")" ]; }

# Poll a URL until it answers, or give up. Returns non-zero on timeout so the
# caller can print the service's own log rather than a generic failure.
wait_for_url() {
  local url="$1" name="$2" tries="${3:-60}" header="${4:-}"
  for i in $(seq 1 "$tries"); do
    [ $((i % 5)) -eq 0 ] && printf "  %s· waiting for %s (%ss)%s\r" "$DIM" "$name" "$i" "$RESET"
    if [ -n "$header" ]; then
      curl -sf -o /dev/null -m 2 -H "$header" "$url" && return 0
    else
      curl -sf -o /dev/null -m 2 "$url" && return 0
    fi
    sleep 1
  done
  return 1
}

# Make a port genuinely usable before starting anything on it.
#
# A busy port is NOT proof that a healthy service owns it. A process that has
# been killed mid-shutdown, or one that bound and then wedged, will hold the
# port while serving nothing — and simply reusing it means the readiness check
# below fails with no explanation. That exact situation cost a long debugging
# session, so this probes the holder and clears it if it is not answering.
ensure_port_available() {
  local port="$1" name="$2" url="$3" header="${4:-}"

  port_busy "$port" || return 0

  local pids owner
  pids="$(port_pids "$port" | tr '\n' ' ')"
  owner="$(ps -p "$(echo "$pids" | awk '{print $1}')" -o comm= 2>/dev/null || echo unknown)"

  # Is whatever holds it actually serving?
  local healthy=1
  if [ -n "$header" ]; then
    curl -sf -o /dev/null -m 2 -H "$header" "$url" || healthy=0
  else
    curl -sf -o /dev/null -m 2 "$url" || healthy=0
  fi

  if [ "$healthy" = "1" ]; then
    warn "$name already running on :$port (pid $pids) — leaving it alone"
    return 1   # signals "do not start another"
  fi

  warn "port $port held by $owner (pid $pids) but not responding — clearing it"
  echo "$pids" | xargs kill -9 2>/dev/null
  sleep 1
  return 0
}

start_service() {
  local name="$1" logfile="$2"; shift 2
  ( "$@" ) > "$logfile" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  printf "%s" "$pid" > "$LOGS/$name.pid"
}

shutdown() {
  printf "\n%s→%s shutting down\n" "$BOLD" "$RESET"
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  # Give each a moment to close its database and Redis handles cleanly.
  sleep 2
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  done
  ok "app services stopped (Postgres and Redis left running)"
  printf "  %sstop those too with: docker compose down%s\n" "$DIM" "$RESET"
  exit 0
}

# --- subcommands -------------------------------------------------------------

cmd_status() {
  step "Status"
  "$DOCKER" compose -f "$COMPOSE_FILE" ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null \
    || warn "docker not reachable"
  for entry in "5173:frontend" "4000:backend" "8000:ml-service"; do
    local port="${entry%%:*}" name="${entry##*:}"
    if port_busy "$port"; then ok "$name listening on $port"; else warn "$name not running (:$port)"; fi
  done
  if pgrep -f batchScoring.worker > /dev/null 2>&1; then ok "worker running"; else warn "worker not running"; fi
}

cmd_stop() {
  step "Stopping app services"
  for pattern in "vite" "src/server.js" "batchScoring.worker" "uvicorn app.main:app"; do
    pkill -f "$pattern" 2>/dev/null && ok "stopped $pattern" || printf "  %s· nothing matching %s%s\n" "$DIM" "$pattern" "$RESET"
  done
  sleep 1
  for port in 5173 4000 8000; do
    local pids; pids="$(port_pids "$port")"
    [ -n "$pids" ] && { echo "$pids" | xargs kill -9 2>/dev/null; ok "freed port $port"; }
  done
  ok "done (Postgres and Redis untouched)"
}

FOLLOW=1
case "${1:-start}" in
  stop)      cmd_stop; exit 0 ;;
  status)    cmd_status; exit 0 ;;
  --detach|-d) FOLLOW=0 ;;
  start)     ;;
  *)         die "unknown command '${1}' — use start, --detach, stop or status" ;;
esac

# --- preflight ---------------------------------------------------------------

step "Preflight"

[ -x "$DOCKER" ] || die "docker not found — install Docker Desktop"
"$DOCKER" info > /dev/null 2>&1 || die "Docker is installed but not running — open Docker Desktop first"
ok "docker running"

[ -f "$ROOT/backend/.env" ]      || die "backend/.env missing — copy backend/.env.example and fill it in"
[ -f "$ROOT/ml_service/.env" ]   || die "ml_service/.env missing — copy ml_service/.env.example and fill it in"
[ -d "$ROOT/backend/node_modules" ]  || die "backend dependencies missing — run: cd backend && npm install"
[ -d "$ROOT/frontend/node_modules" ] || die "frontend dependencies missing — run: cd frontend && npm install"
[ -x "$ROOT/ml_service/.venv/bin/uvicorn" ] || die "ml_service venv missing — run: cd ml_service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
ok "config and dependencies present"

ML_KEY="$(grep -E '^INTERNAL_API_KEY' "$ROOT/ml_service/.env" | head -1 | cut -d'=' -f2- | tr -d '"'"'"' ')"
[ -n "$ML_KEY" ] || die "INTERNAL_API_KEY not set in ml_service/.env"

trap shutdown INT TERM

# --- 1. Postgres + Redis -----------------------------------------------------

step "1/5  Postgres + Redis"
"$DOCKER" compose -f "$COMPOSE_FILE" up -d > "$LOGS/docker.log" 2>&1 \
  || { cat "$LOGS/docker.log"; die "docker compose failed — see logs/docker.log"; }

for _ in $(seq 1 60); do
  healthy="$("$DOCKER" compose -f "$COMPOSE_FILE" ps --format '{{.Health}}' 2>/dev/null | grep -c healthy)"
  [ "$healthy" -ge 2 ] && break
  sleep 1
done
[ "${healthy:-0}" -ge 2 ] || die "containers did not become healthy — check: docker compose logs"
ok "postgres + redis healthy"

# --- 2. ML service -----------------------------------------------------------

step "2/5  ML service"
ensure_port_available 8000 "ml-service" "$ML_URL" "X-Internal-Api-Key: $ML_KEY"
if ! port_busy 8000; then
  # cd rather than --app-dir: that flag fixes the module search path but leaves
  # the working directory alone, and pydantic-settings resolves env_file=".env"
  # relative to cwd — so the service would boot with no INTERNAL_API_KEY.
  start_service ml "$LOGS/ml.log" \
    bash -c "cd '$ROOT/ml_service' && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000"
fi
if wait_for_url "$ML_URL" ml-service 45 "X-Internal-Api-Key: $ML_KEY"; then
  ok "ml-service   :8000"
else
  tail -20 "$LOGS/ml.log" 2>/dev/null
  die "ml-service did not come up — see logs/ml.log"
fi

# --- 3. Backend API ----------------------------------------------------------

step "3/5  Backend API"
ensure_port_available 4000 "backend" "$API_URL"
if ! port_busy 4000; then
  start_service api "$LOGS/api.log" bash -c "cd '$ROOT/backend' && exec node src/server.js"
fi
if wait_for_url "$API_URL" backend 45; then
  ok "backend      :4000"
else
  tail -20 "$LOGS/api.log" 2>/dev/null
  die "backend did not come up — see logs/api.log"
fi

# --- 4. Batch worker ---------------------------------------------------------

step "4/5  Batch worker"
if pgrep -f batchScoring.worker > /dev/null 2>&1; then
  warn "worker already running — leaving it alone"
else
  start_service worker "$LOGS/worker.log" \
    bash -c "cd '$ROOT/backend' && exec node src/workers/batchScoring.worker.js"
  # No HTTP endpoint to poll. The log line is the strongest signal, but pino
  # buffers through a worker thread and may not have flushed yet — so a live
  # process counts as ready too, and only a dead one is a failure.
  ready=0
  for _ in $(seq 1 30); do
    if grep -q "worker ready" "$LOGS/worker.log" 2>/dev/null; then ready=1; break; fi
    sleep 1
    pgrep -f batchScoring.worker > /dev/null 2>&1 || break
  done
  if [ "$ready" = "1" ]; then
    ok "worker       (queue: batch-scoring)"
  elif pgrep -f batchScoring.worker > /dev/null 2>&1; then
    ok "worker       (running; log not yet flushed)"
  else
    tail -20 "$LOGS/worker.log" 2>/dev/null
    die "worker exited on startup — see logs/worker.log"
  fi
fi

# --- 5. Frontend -------------------------------------------------------------

step "5/5  Frontend"
ensure_port_available 5173 "frontend" "$WEB_URL"
if ! port_busy 5173; then
  start_service web "$LOGS/web.log" \
    bash -c "cd '$ROOT/frontend' && exec npx vite --port 5173 --host 127.0.0.1"
fi
if wait_for_url "$WEB_URL" frontend 45; then
  ok "frontend     :5173"
  grep -m1 "Local:" "$LOGS/web.log" 2>/dev/null | sed 's/^/  /'
else
  tail -20 "$LOGS/web.log" 2>/dev/null
  die "frontend did not come up — see logs/web.log"
fi

# --- ready -------------------------------------------------------------------

cat <<EOF

${BOLD}TransactGuard is up${RESET}

  Open        ${BOLD}http://localhost:5173${RESET}
  API         http://localhost:4000/api/v1/health
  ML service  http://localhost:8000/docs

  Logs        logs/{api,ml,worker,web,docker}.log
  Stop        Ctrl-C  (or ./dev.sh stop from another terminal)

EOF

if [ "$FOLLOW" = "0" ]; then
  printf "%sRunning in the background. Stop with: ./dev.sh stop%s\n\n" "$DIM" "$RESET"
  # Detached: drop the trap so exiting this script does not kill the children.
  trap - INT TERM
  exit 0
fi

printf "%sStreaming combined logs — Ctrl-C stops every service.%s\n\n" "$DIM" "$RESET"
tail -f "$LOGS/api.log" "$LOGS/worker.log" "$LOGS/web.log" "$LOGS/ml.log" 2>/dev/null &
PIDS+=("$!")

wait

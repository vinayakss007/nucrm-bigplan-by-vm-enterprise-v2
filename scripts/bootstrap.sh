#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# NuCRM Enterprise - Auto Bootstrap
# Single command to check deps, sync DB, start worker & app
# Usage: bash scripts/bootstrap.sh
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

# ─── Colors ───
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# ─── Node.js ───
if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
  if [ -f "$APP_DIR/.nvmrc" ]; then
    nvm use 2>/dev/null || nvm use 22 2>/dev/null || true
  fi
fi
NODE_VER=$(node -v 2>/dev/null || echo "not found")
info "Node.js: $NODE_VER"

# ─── Environment ───
if [ -f "$APP_DIR/.env.local" ]; then
  set -a
  source "$APP_DIR/.env.local"
  set +a
  ok ".env.local loaded"
fi

export NODE_ENV="${NODE_ENV:-development}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"

# ─── Step 1: PostgreSQL ───
check_postgres() {
  local url="${DATABASE_URL:-}"
  if [ -z "$url" ]; then
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nucrm"
    warn "DATABASE_URL not set, trying default: $DATABASE_URL"
    export DATABASE_URL
  fi

  # Extract host:port from URL
  local host_port
  host_port=$(echo "$DATABASE_URL" | sed -E 's|^.*@([^/]+)/.*|\1|')
  local host="${host_port%:*}"
  local port="${host_port##*:}"
  [ "$host" = "$host_port" ] && port=5432

  info "Checking PostgreSQL at $host:$port..."
  if command -v pg_isready &>/dev/null; then
    PGPING=$(PGPASSWORD="" pg_isready -h "$host" -p "$port" -t 5 2>/dev/null || true)
  else
    PGPING=$(timeout 5 bash -c "echo > /dev/tcp/$host/$port 2>/dev/null" 2>/dev/null && echo "accepting" || echo "")
  fi

  if [ -n "$PGPING" ]; then
    ok "PostgreSQL reachable at $host:$port"
  else
    # Try to start local PostgreSQL
    if [ -f /usr/bin/pg_ctlcluster ] && command -v pg_lsclusters &>/dev/null; then
      warn "PostgreSQL not responding, attempting to start..."
      pg_lsclusters 2>/dev/null | grep -q online || pg_ctlcluster 15 main start 2>/dev/null || true
      sleep 2
      PGPING=$(pg_isready -h "$host" -p "$port" -t 5 2>/dev/null || true)
    fi
    if [ -z "$PGPING" ]; then
      fail "PostgreSQL is NOT reachable at $host:$port"
      echo ""
      echo "  Set DATABASE_URL in .env.local, e.g.:"
      echo "    DATABASE_URL=postgresql://user:pass@host:5432/dbname"
      echo ""
      echo "  Or start local postgres: sudo pg_ctlcluster 15 main start"
      exit 1
    fi
    ok "PostgreSQL started"
  fi

  # Test connection
  local db_name
  db_name=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
  local user
  user=$(echo "$DATABASE_URL" | sed -E 's|^.*://([^:]+).*|\1|')
  local pass
  pass=$(echo "$DATABASE_URL" | sed -E 's|^.*://[^:]+:([^@]+).*|\1|')

  if PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db_name" -c "SELECT 1" &>/dev/null; then
    ok "Database '$db_name' accessible"
  else
    warn "Database '$db_name' not found, creating..."
    PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d postgres -c "CREATE DATABASE \"$db_name\"" 2>/dev/null || true
    if PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db_name" -c "SELECT 1" &>/dev/null; then
      ok "Database '$db_name' created"
    else
      fail "Cannot access database '$db_name'. Check credentials in DATABASE_URL"
      exit 1
    fi
  fi
}

# ─── Step 2: Redis ───
check_redis() {
  local url="${REDIS_URL:-redis://localhost:6379}"
  export REDIS_URL="$url"

  local host="localhost"
  local port="6379"
  if echo "$url" | grep -q redis://; then
    host=$(echo "$url" | sed -E 's|redis://([^:/]+).*|\1|')
    port=$(echo "$url" | sed -E 's|.*:([0-9]+).*|\1|')
  fi

  info "Checking Redis at $host:$port..."
  if command -v redis-cli &>/dev/null; then
    if redis-cli -h "$host" -p "$port" ping 2>/dev/null | grep -q PONG; then
      ok "Redis reachable at $host:$port"
    else
      warn "Redis not responding, attempting to start..."
      if command -v redis-server &>/dev/null; then
        redis-server --daemonize yes 2>/dev/null || true
        sleep 1
      fi
      if redis-cli -h "$host" -p "$port" ping 2>/dev/null | grep -q PONG; then
        ok "Redis started"
      else
        warn "Redis unavailable. Worker will use in-memory fallback (limited functionality)."
      fi
    fi
  else
    warn "redis-cli not installed. Worker may fall back to in-memory."
  fi
}

# ─── Step 3: DB Sync ───
sync_database() {
  info "Syncing database schema..."
  if npx drizzle-kit push --config=./drizzle.config.ts 2>&1; then
    ok "Database schema synced"
  else
    warn "Schema sync had issues (may be index conflicts, DB may still work)"
  fi
}

# ─── Step 4: Check Setup Status ───
check_setup() {
  local db_name
  db_name=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
  local user
  user=$(echo "$DATABASE_URL" | sed -E 's|^.*://([^:]+).*|\1|')
  local pass
  pass=$(echo "$DATABASE_URL" | sed -E 's|^.*://[^:]+:([^@]+).*|\1|')
  local host
  host=$(echo "$DATABASE_URL" | sed -E 's|^.*@([^:/]+).*|\1|')
  local port
  port=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')

  local admin_count
  admin_count=$(PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db_name" -t -c "SELECT COUNT(*) FROM users WHERE is_super_admin = true" 2>/dev/null | tr -d ' ' || echo "0")

  if [ "$admin_count" = "0" ] || [ -z "$admin_count" ]; then
    warn "No super admin found — visit http://localhost:${PORT}/setup to create one"
  else
    ok "Super admin exists ($admin_count), login at http://localhost:${PORT}/auth/login"
  fi
}

# ─── Step 5: Build (if needed) ───
check_build() {
  if [ "$NODE_ENV" = "production" ]; then
    if [ ! -d "$APP_DIR/.next" ]; then
      info "Building production bundle..."
      npm run build 2>&1 | tail -5
      ok "Build complete"
    else
      ok "Build exists (.next/)"
    fi
  fi
}

# ─── Step 6: Start Worker (background) ───
start_worker() {
  info "Starting background worker..."
  if [ "$NODE_ENV" = "production" ]; then
    nohup npx tsx worker.ts > "$APP_DIR/logs/worker.log" 2>&1 &
  else
    nohup npx tsx watch worker.ts > "$APP_DIR/logs/worker.log" 2>&1 &
  fi
  local pid=$!
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    ok "Worker started (PID: $pid)"
  else
    warn "Worker exited immediately — check logs/worker.log"
  fi
}

# ─── Step 7: Start App ───
start_app() {
  info "Starting NuCRM..."
  local cmd
  if [ "$NODE_ENV" = "production" ]; then
    export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=2048"
    cmd="npx next start -H $HOST -p $PORT"
    info "Mode: PRODUCTION on $HOST:$PORT"
  else
    cmd="npx next dev"
    info "Mode: DEVELOPMENT on 0.0.0.0:$PORT"
  fi

  nohup $cmd > "$APP_DIR/logs/app.log" 2>&1 &
  local pid=$!
  sleep 3

  if kill -0 "$pid" 2>/dev/null; then
    ok "App started (PID: $pid)"
  else
    fail "App failed to start — check logs/app.log"
    tail -20 "$APP_DIR/logs/app.log"
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     NuCRM Enterprise Bootstrap              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

mkdir -p "$APP_DIR/logs"

check_postgres
check_redis
sync_database
check_setup
check_build
start_worker
start_app

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  NuCRM is running!                           ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  App:   http://localhost:${PORT}                ║${NC}"
echo -e "${GREEN}║  Setup: http://localhost:${PORT}/setup          ║${NC}"
echo -e "${GREEN}║  Login: http://localhost:${PORT}/auth/login     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
info "Logs: $APP_DIR/logs/"
info "Stop: kill \$(pgrep -f 'next start\|next dev\|worker.ts')"
echo ""

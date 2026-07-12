#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# NuCRM Enterprise - Clean Start
# Single command: build → ensure DB ready → run migrations → seed → start
# Usage: bash scripts/start-clean.sh
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# ─── Load .env ───
if [ -f "$APP_DIR/.env.local" ]; then
  set -a; source "$APP_DIR/.env.local"; set +a
  ok ".env.local loaded"
elif [ -f "$APP_DIR/.env" ]; then
  set -a; source "$APP_DIR/.env"; set +a
  ok ".env loaded"
else
  fail "No .env or .env.local found. Create one with DATABASE_URL."
  exit 1
fi

export NODE_ENV="${NODE_ENV:-development}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"

# ─── Step 1: Check PostgreSQL ───
check_postgres() {
  local url="${DATABASE_URL:-}"
  if [ -z "$url" ]; then
    fail "DATABASE_URL not set in .env"
    exit 1
  fi

  local host_port
  host_port=$(echo "$url" | sed -E 's|^.*@([^/]+)/.*|\1|')
  local host="${host_port%:*}"
  local port="${host_port##*:}"
  [ "$host" = "$host_port" ] && port=5432

  info "Checking PostgreSQL at $host:$port..."
  if command -v pg_isready &>/dev/null; then
    PGPING=$(pg_isready -h "$host" -p "$port" -t 5 2>/dev/null || true)
  else
    PGPING=$(timeout 5 bash -c "echo > /dev/tcp/$host/$port 2>/dev/null" 2>/dev/null && echo "accepting" || echo "")
  fi

  if [ -z "$PGPING" ]; then
    fail "PostgreSQL is NOT reachable at $host:$port"
    echo "  Start it: sudo systemctl start postgresql"
    exit 1
  fi
  ok "PostgreSQL reachable at $host:$port"

  local db_name
  db_name=$(echo "$url" | sed -E 's|.*/([^?]+).*|\1|')
  local user
  user=$(echo "$url" | sed -E 's|^.*://([^:]+).*|\1|')
  local pass
  pass=$(echo "$url" | sed -E 's|^.*://[^:]+:([^@]+).*|\1|')

  if PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db_name" -c "SELECT 1" &>/dev/null; then
    ok "Database '$db_name' accessible"
  else
    warn "Database '$db_name' not found, creating..."
    PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d postgres -c "CREATE DATABASE \"$db_name\"" 2>/dev/null || true
    if PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db_name" -c "SELECT 1" &>/dev/null; then
      ok "Database '$db_name' created"
    else
      fail "Cannot access database '$db_name'"
      exit 1
    fi
  fi
}

# ─── Step 2: Run Migrations ───
run_migrations() {
  info "Running database migrations..."
  npx tsx scripts/migrate.ts --yes
  ok "Migrations complete"
}

# ─── Step 3: Run Seed ───
run_seed() {
  info "Running development seed..."
  npx tsx scripts/seed-dev.ts
  ok "Seed complete"
}

# ─── Step 4: Build App ───
build_app() {
  info "Building application..."
  npm run build
  ok "Build complete"
}

# ─── Step 5: Start App ───
start_app() {
  info "Starting NuCRM..."
  if [ "$NODE_ENV" = "production" ]; then
    export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=2048"
    info "Mode: PRODUCTION on $HOST:$PORT"
    exec npx next start -H "$HOST" -p "$PORT"
  else
    info "Mode: DEVELOPMENT on 0.0.0.0:$PORT"
    exec npx next dev
  fi
}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   NuCRM Enterprise - Clean Start            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

build_app
check_postgres
run_migrations
run_seed
start_app

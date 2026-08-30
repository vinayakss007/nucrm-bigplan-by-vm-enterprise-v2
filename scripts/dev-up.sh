#!/usr/bin/env bash
#
# dev-up.sh — Bring up a local Postgres instance and the NuCRM app together
# in a single shell session.
#
# WHY A SINGLE SCRIPT:
#   Some sandboxed/ephemeral environments run each command in an isolated PID
#   namespace with `--die-with-parent`, so a Postgres server started in one
#   shell is killed when that shell exits. To use the app interactively you must
#   start the database and the web server in the SAME long-lived process. This
#   script does exactly that.
#
# WHAT IT DOES:
#   1. Loads Node (via nvm if present) and reads .env.local.
#   2. Ensures a local PostgreSQL data dir exists (initdb on first run).
#   3. Starts Postgres listening on a Unix socket (TCP loopback is blocked in
#      some sandboxes, so we prefer the socket).
#   4. Creates the database + required extensions if missing.
#   5. Runs pending migrations (idempotent).
#   6. Starts the Next.js app in the foreground (Ctrl-C stops app + Postgres).
#
# USAGE:
#   bash scripts/dev-up.sh              # build (if needed) + prod start
#   MODE=dev bash scripts/dev-up.sh     # next dev instead of next start
#   PORT=3001 bash scripts/dev-up.sh    # custom port (default 3000)
#
# ENV OVERRIDES:
#   PGDATA   Postgres data dir      (default: /var/lib/pgsql/data)
#   PGSOCK   Postgres socket dir    (default: /var/lib/pgsql/sockets)
#   PGBIN    Postgres bin dir       (default: auto-detected)
#   DB_NAME  Database name          (default: nucrm)
#   DB_USER  Database user/owner    (default: nucrm)
#   DB_PASS  Database password      (default: nucrm)
#   PORT     App port               (default: 3000)
#   MODE     "prod" (default) | "dev"
#
set -euo pipefail

# ---- Config -----------------------------------------------------------------
PGDATA="${PGDATA:-/var/lib/pgsql/data}"
PGSOCK="${PGSOCK:-/var/lib/pgsql/sockets}"
DB_NAME="${DB_NAME:-nucrm}"
DB_USER="${DB_USER:-nucrm}"
DB_PASS="${DB_PASS:-nucrm}"
PORT="${PORT:-3000}"
MODE="${MODE:-prod}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---- Locate the postgres binaries ------------------------------------------
if [[ -z "${PGBIN:-}" ]]; then
  for cand in /usr/bin /usr/pgsql-16/bin /usr/pgsql-15/bin /usr/lib/postgresql/*/bin; do
    if [[ -x "$cand/pg_ctl" ]]; then PGBIN="$cand"; break; fi
  done
fi
PGBIN="${PGBIN:-/usr/bin}"
if [[ ! -x "$PGBIN/pg_ctl" ]]; then
  echo "ERROR: pg_ctl not found. Install postgresql server (e.g. dnf install postgresql15-server postgresql15-contrib)." >&2
  exit 1
fi
echo "[dev-up] Using Postgres binaries in: $PGBIN"

# ---- Load Node --------------------------------------------------------------
# When invoked via `npm run`, npm sets npm_config_prefix, which is incompatible
# with nvm and makes `nvm use` fail (leaving node off PATH). Unset it first.
unset npm_config_prefix 2>/dev/null || true
if ! command -v node >/dev/null 2>&1 && [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
fi
command -v node >/dev/null 2>&1 || { echo "ERROR: node not on PATH." >&2; exit 1; }
echo "[dev-up] Node: $(node -v)"

# ---- Ensure .env.local exists ----------------------------------------------
if [[ ! -f .env.local ]]; then
  echo "[dev-up] .env.local not found — copying from .env.example." >&2
  cp .env.example .env.local
  echo "[dev-up] NOTE: fill in secrets (JWT_SECRET, SESSION_SECRET, etc.) in .env.local." >&2
fi

# ---- Initialize the data directory on first run ----------------------------
mkdir -p "$PGDATA" "$PGSOCK"
# Run Postgres as the unprivileged 'postgres' user when we are root.
PG_RUN_USER=""
if [[ "$(id -u)" == "0" ]]; then
  id postgres >/dev/null 2>&1 || useradd postgres
  PG_RUN_USER="postgres"
  chown -R postgres:postgres "$(dirname "$PGDATA")"
fi

run_pg() {
  # Run a command as the postgres user if we are root, else directly.
  if [[ -n "$PG_RUN_USER" ]]; then
    su -s /bin/sh "$PG_RUN_USER" -c "$1"
  else
    sh -c "$1"
  fi
}

if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  echo "[dev-up] Initializing Postgres data dir at $PGDATA ..."
  run_pg "$PGBIN/initdb -D '$PGDATA' --auth-local=trust --auth-host=md5 -U '$DB_USER'"
fi

# ---- Start Postgres ---------------------------------------------------------
echo "[dev-up] Starting Postgres (socket dir: $PGSOCK) ..."
run_pg "$PGBIN/pg_ctl -D '$PGDATA' -l '$(dirname "$PGDATA")/logfile' \
  -o '-p 5432 -k $PGSOCK -c listen_addresses=127.0.0.1' -w start" || {
    echo "[dev-up] pg_ctl reported an error (server may already be running); continuing." >&2
  }

# Wait for the socket to accept connections.
for _ in $(seq 1 30); do
  if "$PGBIN/psql" -h "$PGSOCK" -p 5432 -U "$DB_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ---- Ensure role password, database, and extensions exist -------------------
PSQL="$PGBIN/psql -h $PGSOCK -p 5432 -U $DB_USER"
$PSQL -d postgres -c "ALTER USER \"$DB_USER\" WITH PASSWORD '$DB_PASS';" >/dev/null 2>&1 || true
if ! $PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "[dev-up] Creating database '$DB_NAME' ..."
  $PSQL -d postgres -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
fi
$PSQL -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS "pg_trgm";' >/dev/null

# ---- Load env for the app ---------------------------------------------------
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
# Force the socket connection string for local dev (TCP loopback may be blocked).
export DATABASE_URL="${DATABASE_URL:-postgresql://$DB_USER:$DB_PASS@/$DB_NAME?host=$PGSOCK}"

# Align NODE_ENV with the run mode so Next.js doesn't warn about a mismatch
# (`next start` expects production; `next dev` expects development).
if [[ "$MODE" == "dev" ]]; then
  export NODE_ENV="development"
else
  export NODE_ENV="production"
fi

# ---- Run migrations (idempotent) -------------------------------------------
echo "[dev-up] Applying migrations ..."
npx tsx scripts/migrate.ts --yes < /dev/null

# ---- Stop Postgres when the app exits --------------------------------------
cleanup() {
  echo ""
  echo "[dev-up] Shutting down Postgres ..."
  run_pg "$PGBIN/pg_ctl -D '$PGDATA' -m fast stop" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# ---- Start the app (foreground) --------------------------------------------
echo "[dev-up] Starting NuCRM on http://localhost:$PORT (mode: $MODE) ..."
if [[ "$MODE" == "dev" ]]; then
  exec node node_modules/next/dist/bin/next dev -p "$PORT"
else
  # Build if there is no prior build output.
  if [[ ! -d .next ]]; then
    echo "[dev-up] No .next build found — building ..."
    node node_modules/next/dist/bin/next build
  fi
  exec node node_modules/next/dist/bin/next start -p "$PORT"
fi

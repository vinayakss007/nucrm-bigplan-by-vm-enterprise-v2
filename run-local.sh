#!/usr/bin/env bash
###############################################################################
#  NuCRM – Run WITHOUT Docker (Native Local Setup)
#
#  Usage:  ./run-local.sh              # Full setup + run
#          ./run-local.sh --run-only   # Just run (assume DB + deps ready)
#          ./run-local.sh --setup-only # Install deps + setup DB only
#          ./run-local.sh --dev        # Run in dev mode with hot reload
#          ./run-local.sh --dev-all    # Dev mode + worker in parallel
#          ./run-local.sh --help
#
#  This script:
#    1. Checks Node.js, npm, PostgreSQL, Redis are installed locally
#    2. Installs npm dependencies
#    3. Creates .env.local if missing
#    4. Runs database migrations
#    5. Starts the app (+ optional worker)
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${BLUE}[LOCAL]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

show_help() {
    cat <<'EOF'
NuCRM – Run WITHOUT Docker (Native Local Setup)

USAGE:
    ./run-local.sh [OPTION]

OPTIONS:
    (none)          Full setup: check, install, migrate, run production
    --setup-only    Install deps + setup env + migrate (don't start app)
    --run-only      Just start the app (assumes everything is ready)
    --dev           Run in development mode (hot reload, single process)
    --dev-all       Dev mode + background worker (hot reload)
    --worker        Run background worker only
    --migrate       Run database migrations only
    --status        Check if local services are running
    --stop          Stop all NuCRM processes
    --help          Show this help

PREREQUISITES (install these yourself):
    • Node.js >= 22        (check: node --version)
    • npm                  (check: npm --version)
    • PostgreSQL >= 15     (check: psql --version)
    • Redis >= 7           (check: redis-cli --version)

QUICK PREREQUISITE INSTALL (Ubuntu/Debian):
    sudo apt update
    sudo apt install -y postgresql redis-server
    # Then install Node.js 22 via nvm or nodesource

QUICK PREREQUISITE INSTALL (macOS with Homebrew):
    brew install node@22 postgresql redis
    brew services start postgresql
    brew services start redis
EOF
    exit 0
}

# ── Prerequisites ───────────────────────────────────────────────────────────
check_prereqs() {
    log "Checking local prerequisites…"

    # Node.js
    if command -v node >/dev/null 2>&1; then
        NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if (( NODE_VER < 22 )); then
            err "Node.js >= 22 required (found v$(node --version)). Run: nvm install 22"
        fi
        ok "Node.js $(node --version)"
    else
        err "Node.js not found. Install Node.js 22+ from https://nodejs.org or use nvm"
    fi

    # npm
    if command -v npm >/dev/null 2>&1; then
        ok "npm $(npm --version)"
    else
        err "npm not found"
    fi

    # PostgreSQL
    if command -v psql >/dev/null 2>&1; then
        ok "PostgreSQL $(psql --version)"
    else
        err "PostgreSQL not found. Install: sudo apt install postgresql (Ubuntu) or brew install postgresql (macOS)"
    fi

    # Redis
    if command -v redis-cli >/dev/null 2>&1; then
        ok "Redis $(redis-cli --version)"
    else
        err "Redis not found. Install: sudo apt install redis-server (Ubuntu) or brew install redis (macOS)"
    fi
}

# ── Check local services are running ────────────────────────────────────────
check_services() {
    log "Checking local services…"

    # PostgreSQL
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
        ok "PostgreSQL: running on localhost:5432"
    else
        err "PostgreSQL: NOT running. Start it:"
        echo "   Ubuntu: sudo systemctl start postgresql"
        echo "   macOS:  brew services start postgresql"
        echo "   Manual: pg_ctl -D /path/to/data start"
        return 1
    fi

    # Redis
    if redis-cli -h localhost -p 6379 ping 2>/dev/null | grep -q PONG; then
        ok "Redis: running on localhost:6379"
    else
        err "Redis: NOT running. Start it:"
        echo "   Ubuntu: sudo systemctl start redis-server"
        echo "   macOS:  brew services start redis"
        echo "   Manual: redis-server --daemonize yes"
        return 1
    fi
}

# ── Environment ─────────────────────────────────────────────────────────────
setup_env() {
    ENV_FILE=".env.local"
    if [[ ! -f "$ENV_FILE" ]]; then
        warn "Creating .env.local with secure secrets…"
        POSTGRES_PW=$(openssl rand -base64 32)
        {
            echo "POSTGRES_PASSWORD=${POSTGRES_PW}"
            echo "DATABASE_URL=postgresql://postgres:${POSTGRES_PW}@localhost:5432/nucrm"
            echo "JWT_SECRET=$(openssl rand -base64 64)"
            echo "SETUP_KEY=$(openssl rand -hex 24)"
            echo "CRON_SECRET=$(openssl rand -hex 48)"
            echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
            echo "ALLOWED_ORIGINS=http://localhost:3000"
            echo "NODE_ENV=development"
            echo "DATABASE_SSL=false"
            echo "REDIS_URL=redis://localhost:6379"
        } > "$ENV_FILE"
        ok "Created .env.local"
    else
        ok ".env.local already exists"
    fi

    # Load env vars for this session
    set -a
    source "$ENV_FILE"
    set +a
}

# ── Setup local PostgreSQL user/db ─────────────────────────────────────────
setup_database() {
    log "Setting up local PostgreSQL database…"

    # Default postgres user (common setup)
    PG_USER="${PGUSER:-postgres}"
    PG_HOST="${PGHOST:-localhost}"
    PG_PORT="${PGPORT:-5432}"
    DB_NAME="nucrm"

    # Try to get DB password from env
    DB_PASSWORD="${POSTGRES_PASSWORD:-}"

    # Function to run psql with appropriate credentials
    run_psql() {
        local cmd="$1"
        if [[ -n "$DB_PASSWORD" ]]; then
            PGPASSWORD="$DB_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -c "$cmd" 2>/dev/null
        else
            # Try without password (peer auth or trust)
            psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -c "$cmd" 2>/dev/null
        fi
    }

    # Try to create user (may fail if already exists or no superuser access)
    log "Creating database user 'postgres' if not exists…"
    if command -v createuser >/dev/null 2>&1; then
        if [[ -n "$DB_PASSWORD" ]]; then
            PGPASSWORD="$DB_PASSWORD" createuser -h "$PG_HOST" -p "$PG_PORT" --superuser --createdb --createrole postgres 2>/dev/null || true
        else
            sudo -u postgres createuser --superuser --createdb --createrole postgres 2>/dev/null || true
        fi
    fi

    # Try to create database
    log "Creating database '$DB_NAME' if not exists…"
    if command -v createdb >/dev/null 2>&1; then
        if [[ -n "$DB_PASSWORD" ]]; then
            PGPASSWORD="$DB_PASSWORD" createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$DB_NAME" 2>/dev/null || true
        else
            sudo -u postgres createdb "$DB_NAME" 2>/dev/null || true
            # If sudo didn't work, try direct
            createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$DB_NAME" 2>/dev/null || true
        fi
    fi

    # If .env.local DATABASE_URL not set, update it
    if [[ -z "${DATABASE_URL:-}" ]]; then
        local PG_PW="${POSTGRES_PASSWORD:-}"
        if [[ -n "$PG_PW" ]]; then
            export DATABASE_URL="postgresql://postgres:${PG_PW}@localhost:5432/nucrm"
        else
            export DATABASE_URL="postgresql://postgres@localhost:5432/nucrm"
        fi
        # Update .env.local
        if [[ -f .env.local ]]; then
            if grep -q "^DATABASE_URL=" .env.local; then
                sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env.local
            else
                echo "DATABASE_URL=${DATABASE_URL}" >> .env.local
            fi
        fi
    fi

    ok "Database setup complete (or already exists)"
    info "DATABASE_URL=${DATABASE_URL}"
}

# ── Install dependencies ───────────────────────────────────────────────────
install_deps() {
    log "Installing npm dependencies…"
    npm install --legacy-peer-deps
    ok "Dependencies installed"
}

# ── Migrations ──────────────────────────────────────────────────────────────
run_migrations() {
    log "Running database migrations…"
    if npx tsx scripts/push-db.mts 2>&1; then
        ok "Migrations complete"
    else
        warn "Migration finished with warnings (schema may already be up-to-date)"
    fi
}

# ── Run production ──────────────────────────────────────────────────────────
run_production() {
    log "Building application…"
    npm run build

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   🚀  NuCRM Running (NO Docker)!                          ║${NC}"
    echo -e "${GREEN}║   🌐  http://localhost:3000                               ║${NC}"
    echo -e "${GREEN}║   ⚙️   Setup: http://localhost:3000/setup                 ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log "Starting app server + worker…"
    log "Press Ctrl+C to stop."
    echo ""

    # Start worker in background, app in foreground
    log "Starting background worker…"
    npx tsx worker.ts &
    WORKER_PID=$!

    # Trap to kill worker on exit
    trap "kill $WORKER_PID 2>/dev/null; ok 'Worker stopped'" EXIT

    log "Starting app server…"
    npm start
}

# ── Run dev mode ────────────────────────────────────────────────────────────
run_dev() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   🔧  NuCRM Dev Mode (NO Docker)                          ║${NC}"
    echo -e "${CYAN}║   🌐  http://localhost:3000                               ║${NC}"
    echo -e "${CYAN}║   Hot reload enabled                                      ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log "Starting dev server…"
    npm run dev
}

# ── Run dev mode with worker ────────────────────────────────────────────────
run_dev_all() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   🔧  NuCRM Dev Mode + Worker (NO Docker)                 ║${NC}"
    echo -e "${CYAN}║   🌐  http://localhost:3000                               ║${NC}"
    echo -e "${CYAN}║   Hot reload + background worker                          ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    npm run dev:all
}

# ── Run worker only ─────────────────────────────────────────────────────────
run_worker() {
    log "Starting background worker…"
    npx tsx worker.ts
}

# ── Stop all ────────────────────────────────────────────────────────────────
stop_all() {
    log "Stopping all NuCRM processes…"
    # Kill node processes running next/worker in this directory
    pkill -f "next start" 2>/dev/null || true
    pkill -f "tsx worker.ts" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    ok "All NuCRM processes stopped"
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
    case "${1:-}" in
        --help|-h)
            show_help
            ;;
        --setup-only)
            check_prereqs
            check_services
            setup_env
            setup_database
            install_deps
            run_migrations
            ok "Setup complete! Run ./run-local.sh --run-only to start"
            ;;
        --run-only)
            setup_env
            log "Starting production server…"
            run_production
            ;;
        --dev)
            check_prereqs
            check_services
            setup_env
            install_deps
            run_dev
            ;;
        --dev-all)
            check_prereqs
            check_services
            setup_env
            install_deps
            run_dev_all
            ;;
        --worker)
            setup_env
            run_worker
            ;;
        --migrate)
            setup_env
            run_migrations
            ;;
        --status)
            check_services 2>&1 || true
            # Check if app is running
            if curl -s http://localhost:3000/api/health >/dev/null 2>&1; then
                ok "NuCRM app: running on port 3000"
            else
                warn "NuCRM app: not running"
            fi
            ;;
        --stop)
            stop_all
            ;;
        "")
            echo -e "${BLUE}"
            echo "  ╔═══════════════════════════════════════════════╗"
            echo "  ║   NuCRM – Native Local Setup (NO Docker)      ║"
            echo "  ╚═══════════════════════════════════════════════╝"
            echo -e "${NC}"

            check_prereqs
            check_services
            setup_env
            setup_database
            install_deps
            run_migrations
            run_production
            ;;
        *)
            err "Unknown option: $1. Run ./run-local.sh --help"
            ;;
    esac
}

main "$@"

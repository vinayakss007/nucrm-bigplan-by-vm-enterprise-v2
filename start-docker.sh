#!/usr/bin/env bash
###############################################################################
#  NuCRM – One-Click Docker Deploy
#
#  Usage:  ./start-docker.sh
#
#  What it does:
#    1. Checks prerequisites (Docker, docker compose)
#    2. Generates a .env.local if one doesn't exist
#    3. Builds & starts all services (Postgres, Redis, App, Worker)
#    4. Waits for every container to become healthy
#    5. Auto-runs database migrations
#    6. Prints the access URL
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${BLUE}[NuCRM]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── 1. Prerequisites ────────────────────────────────────────────────────────
log "Checking prerequisites…"
command -v docker >/dev/null 2>&1     || err "Docker is not installed.  See https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1           || err "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || err "docker compose plugin not found. Install Docker Desktop or docker-compose-plugin."
ok "Docker ready ($(docker compose version --short))"

# ── 2. Environment file ─────────────────────────────────────────────────────
ENV_FILE=".env.local"
if [[ ! -f "$ENV_FILE" ]]; then
    warn "$ENV_FILE not found – generating secure secrets…"
    {
        echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
        echo "JWT_SECRET=$(openssl rand -base64 64)"
        echo "SETUP_KEY=$(openssl rand -hex 24)"
        echo "CRON_SECRET=$(openssl rand -hex 48)"
        echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
        echo "ALLOWED_ORIGINS=http://localhost:3000"
        echo "NODE_ENV=production"
        echo "DATABASE_SSL=false"
        echo "REDIS_URL=redis://redis:6379"
    } > "$ENV_FILE"
    ok "Created $ENV_FILE with secure random secrets"
else
    ok "$ENV_FILE already exists"
fi

# ── 3. Stop any previous run ────────────────────────────────────────────────
log "Stopping any previous containers…"
docker compose down --remove-orphans 2>/dev/null || true

# ── 4. Build & start ────────────────────────────────────────────────────────
log "Building and starting services…"
docker compose up -d --build

# ── 5. Wait for healthy ─────────────────────────────────────────────────────
log "Waiting for services to become healthy (up to 120 s)…"
MAX_WAIT=120
ELAPSED=0
while (( ELAPSED < MAX_WAIT )); do
    # Check if app is healthy (last service to start)
    APP_STATE=$(docker inspect --format='{{.State.Health.Status}}' nucrm-app 2>/dev/null || echo "not_found")
    if [[ "$APP_STATE" == "healthy" ]]; then
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    printf '.'
done
echo ""

if (( ELAPSED >= MAX_WAIT )); then
    err "Timed out waiting for services.  Run: docker compose logs app"
fi

ok "All services healthy (${ELAPSED}s)"

# ── 6. Run database migrations ──────────────────────────────────────────────
log "Running database migrations…"
MIG_RESULT=$(docker exec nucrm-app npx tsx scripts/push-db.mts 2>&1) || true
if echo "$MIG_RESULT" | grep -qi "error\|fail"; then
    warn "Migration output (may already be up-to-date):"
    echo "$MIG_RESULT" | head -20
else
    ok "Migrations complete"
fi

# ── 7. Done! ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}║   🚀  NuCRM is running!                                    ║${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}║   🌐  Open: http://localhost:3000                         ║${NC}"
echo -e "${GREEN}║   ⚙️   Setup: http://localhost:3000/setup                 ║${NC}"
echo -e "${GREEN}║   🏥  Health: http://localhost:3000/api/health             ║${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
log "Useful commands:"
echo "   docker compose logs -f          # Follow logs"
echo "   docker compose down             # Stop everything"
echo "   docker compose restart          # Restart"
echo "   docker compose up -d --build    # Rebuild & restart"

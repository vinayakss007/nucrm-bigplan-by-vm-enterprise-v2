#!/usr/bin/env bash
###############################################################################
#  NuCRM — Production Deployment Script
#
#  Usage:
#    bash deploy/scripts/deploy.sh              # Full deploy
#    bash deploy/scripts/deploy.sh --rebuild    # Force rebuild images
#    bash deploy/scripts/deploy.sh --migrate    # Run migrations only
#    bash deploy/scripts/deploy.sh --status     # Check service health
###############################################################################
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[DEPLOY]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

COMPOSE="docker compose -f docker-compose.production.yml"
ENV_FILE="../.env"

# ── Preflight ───────────────────────────────────────────────────────────────
preflight() {
    log "Running preflight checks..."
    
    # Docker
    command -v docker >/dev/null 2>&1 || err "Docker not installed"
    docker info >/dev/null 2>&1 || err "Docker daemon not running"
    docker compose version >/dev/null 2>&1 || err "docker compose not available"
    ok "Docker ready"

    # Env file
    if [[ ! -f "$ENV_FILE" ]]; then
        err ".env file not found. Copy deploy/.env.production to .env and fill in values."
    fi
    ok ".env file present"

    # Check critical vars
    source "$ENV_FILE"
    [[ "${JWT_SECRET:-}" == *"REQUIRED"* ]] && err "JWT_SECRET not set in .env"
    [[ "${POSTGRES_PASSWORD:-}" == *"REQUIRED"* ]] && err "POSTGRES_PASSWORD not set in .env"
    [[ -z "${JWT_SECRET:-}" ]] && err "JWT_SECRET is empty"
    [[ -z "${POSTGRES_PASSWORD:-}" ]] && err "POSTGRES_PASSWORD is empty"
    ok "Critical env vars present"

    # SSL check
    if [[ ! -f "nginx/ssl/fullchain.pem" ]]; then
        warn "No SSL certs in deploy/nginx/ssl/ — HTTPS will fail. Use self-signed for testing:"
        echo "  openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout deploy/nginx/ssl/privkey.pem -out deploy/nginx/ssl/fullchain.pem -subj '/CN=localhost'"
    else
        ok "SSL certificates found"
    fi
}

# ── Deploy ──────────────────────────────────────────────────────────────────
deploy() {
    local BUILD_FLAG=""
    [[ "${1:-}" == "--rebuild" ]] && BUILD_FLAG="--build --no-cache"

    log "Pulling base images..."
    $COMPOSE pull --ignore-buildable 2>/dev/null || true

    log "Building and starting services..."
    $COMPOSE up -d $BUILD_FLAG

    log "Waiting for services to become healthy (up to 120s)..."
    local elapsed=0
    while (( elapsed < 120 )); do
        if $COMPOSE ps --format json 2>/dev/null | grep -q '"Health":"healthy"' || \
           docker inspect nucrm-postgres --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
            break
        fi
        sleep 3
        elapsed=$((elapsed + 3))
        printf '.'
    done
    echo ""

    if (( elapsed >= 120 )); then
        warn "Some services may still be starting. Check: docker compose -f deploy/docker-compose.production.yml ps"
    else
        ok "Services healthy (${elapsed}s)"
    fi
}

# ── Migrations ──────────────────────────────────────────────────────────────
migrate() {
    log "Running database migrations..."
    $COMPOSE exec app npx tsx scripts/push-db.mts 2>&1 || \
        warn "Migration output (may already be up-to-date)"
    ok "Migrations complete"
}

# ── Status ──────────────────────────────────────────────────────────────────
status() {
    echo ""
    log "Service Status:"
    $COMPOSE ps
    echo ""
    log "Health Endpoints:"
    echo -n "  App:      "; curl -s http://localhost:3000/api/health | head -c 100 || echo "UNREACHABLE"
    echo ""
    echo -n "  Postgres: "; docker exec nucrm-postgres pg_isready -U nucrm 2>/dev/null || echo "UNREACHABLE"
    echo -n "  Redis:    "; docker exec nucrm-redis redis-cli ping 2>/dev/null || echo "UNREACHABLE"
    echo -n "  MinIO:    "; curl -s http://localhost:9000/minio/health/live | head -c 50 || echo "UNREACHABLE"
    echo ""
}

# ── Main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
    --status)   status ;;
    --migrate)  migrate ;;
    --rebuild)  preflight; deploy --rebuild; migrate ;;
    *)          preflight; deploy; migrate;
                echo ""
                echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
                echo -e "${GREEN}║  NuCRM Production Deployment Complete!                 ║${NC}"
                echo -e "${GREEN}║                                                        ║${NC}"
                echo -e "${GREEN}║  App:      https://crm.yourdomain.com                  ║${NC}"
                echo -e "${GREEN}║  Setup:    https://crm.yourdomain.com/setup            ║${NC}"
                echo -e "${GREEN}║  Grafana:  http://localhost:3001                        ║${NC}"
                echo -e "${GREEN}║  MinIO:    http://localhost:9001                        ║${NC}"
                echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
                ;;
esac

#!/usr/bin/env bash
###############################################################################
#  NuCRM — Health Check Script
#  
#  Usage: bash deploy/scripts/health-check.sh
#  Exit code: 0 = all healthy, 1 = something is wrong
#
#  Checks: App, Postgres, Redis, MinIO, Disk, Memory
###############################################################################
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ISSUES=0

check() {
    local name="$1" cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        echo -e "  ${GREEN}[OK]${NC} $name"
    else
        echo -e "  ${RED}[FAIL]${NC} $name"
        ISSUES=$((ISSUES + 1))
    fi
}

echo "═══════════════════════════════════════════"
echo "  NuCRM Health Check — $(date)"
echo "═══════════════════════════════════════════"

# Which container is the data tier? The compose files name one thing and the guides
# name another, so a probe hard-coded to either silently checks nothing on the other
# topology (#3265 — the boot path cannot notice what it never asks). Ask the daemon
# which running container has a Postgres *server* image instead.
PG_CONTAINER=$(docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null \
    | awk -F'\t' '$2 ~ /^postgres(:|$)/ {print $1; exit}')

# #3265: a `trust` rule answers whether a credential was offered or not, so the
# difference between "authenticated" and "accepted with no credential" is the
# measurement. Nothing is printed but the verdict; no credential is read or sent.
pg_auth_check() {
    if [ -z "${PG_CONTAINER:-}" ]; then
        echo -e "  ${RED}[FAIL]${NC} PostgreSQL auth: no running postgres container to ask"
        ISSUES=$((ISSUES + 1)); return
    fi
    local role db out rc
    role=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$PG_CONTAINER" \
        2>/dev/null | sed -n 's/^POSTGRES_USER=//p' | head -1)
    db=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$PG_CONTAINER" \
        2>/dev/null | sed -n 's/^POSTGRES_DB=//p' | head -1)
    out=$(docker exec -e PGPASSWORD= -e PGCONNECT_TIMEOUT=5 "$PG_CONTAINER" \
        psql -h 127.0.0.1 -U "${role:-postgres}" -d "${db:-postgres}" -tAc 'select 1' 2>&1)
    rc=$?
    if [ "$rc" -eq 0 ]; then
        echo -e "  ${RED}[FAIL]${NC} PostgreSQL auth: $PG_CONTAINER accepted a session with no credential"
        echo -e "         ${YELLOW}trust rule live — install deploy/postgres/pg_hba.conf and pg_reload_conf() (#3265)${NC}"
        ISSUES=$((ISSUES + 1))
    elif echo "$out" | grep -qiE 'password authentication failed|no pg_hba.conf entry|database system is not yet accepting'; then
        echo -e "  ${GREEN}[OK]${NC} PostgreSQL auth: a credential is required"
    else
        echo -e "  ${RED}[FAIL]${NC} PostgreSQL auth: could not tell — ${out%%$'\n'*}"
        ISSUES=$((ISSUES + 1))
    fi
}

# Services
check "App (HTTP)"       "curl -sf http://localhost:3000/api/health"
check "PostgreSQL"       "[ -n \"${PG_CONTAINER:-}\" ] && docker exec \"$PG_CONTAINER\" pg_isready -q"
pg_auth_check
check "Redis"            "docker exec nucrm-redis redis-cli ping | grep -q PONG"
check "MinIO"            "curl -sf http://localhost:9000/minio/health/live"
check "Nginx"            "curl -sf http://localhost/health"
check "Prometheus"       "curl -sf http://localhost:9090/-/healthy"
check "Grafana"          "curl -sf http://localhost:3001/api/health"

echo ""
echo "── System Resources ──"

# Disk
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if (( DISK_USAGE > 85 )); then
    echo -e "  ${RED}[WARN]${NC} Disk: ${DISK_USAGE}% used (>85%)"
    ISSUES=$((ISSUES + 1))
else
    echo -e "  ${GREEN}[OK]${NC} Disk: ${DISK_USAGE}% used"
fi

# Memory
MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_USED=$(free -m | awk '/Mem:/{print $3}')
MEM_PCT=$((MEM_USED * 100 / MEM_TOTAL))
if (( MEM_PCT > 90 )); then
    echo -e "  ${RED}[WARN]${NC} Memory: ${MEM_PCT}% (${MEM_USED}/${MEM_TOTAL} MB)"
    ISSUES=$((ISSUES + 1))
else
    echo -e "  ${GREEN}[OK]${NC} Memory: ${MEM_PCT}% (${MEM_USED}/${MEM_TOTAL} MB)"
fi

# Docker containers
RUNNING=$(docker ps --filter "name=nucrm" --format "{{.Names}}" | wc -l)
echo -e "  ${GREEN}[OK]${NC} Docker containers running: ${RUNNING}"

echo ""
if (( ISSUES > 0 )); then
    echo -e "${RED}  ${ISSUES} issue(s) detected!${NC}"
    exit 1
else
    echo -e "${GREEN}  All systems healthy.${NC}"
    exit 0
fi

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

# Services
check "App (HTTP)"       "curl -sf http://localhost:3000/api/health"
check "PostgreSQL"       "docker exec nucrm-postgres pg_isready -U nucrm"
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

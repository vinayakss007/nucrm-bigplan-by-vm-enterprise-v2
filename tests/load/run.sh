#!/bin/bash
# Load Test Runner for CI/CD
#
# Usage:
#   ./tests/load/run.sh              # Run all tests
#   ./tests/load/run.sh baseline     # Run only baseline
#   ./tests/load/run.sh write-heavy  # Run only write-heavy
#   ./tests/load/run.sh multi-tenant # Run only multi-tenant
#
# Environment:
#   BASE_URL       - Target URL (default: http://localhost:3000; use
#                    https://localhost for the nginx-fronted deployed app)
#   SESSIONS_FILE  - JSON array of {session, csrf} pairs (preferred; build
#                    with ./tests/load/make-sessions.sh). Login itself is
#                    rate-limited, so load runs must not authenticate per-VU
#                    against a deployed instance.
#   EMAIL/PASSWORD - Fallback single-account login (relaxed-limiter dev only)
#   TENANTn_EMAIL/TENANTn_PASSWORD - multi-tenant fallback login (n=1..3)
#   CI             - Set to "true" for CI mode (fails on threshold breach)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
CI="${CI:-false}"

if [ -z "${SESSIONS_FILE:-}" ] && { [ -z "${EMAIL:-}" ] || [ -z "${PASSWORD:-}" ]; }; then
  echo -e "${RED}No auth source: set SESSIONS_FILE, or EMAIL+PASSWORD (dev instances only - login is rate-limited). See #2120.${NC}"
  exit 1
fi
if [ -n "${SESSIONS_FILE:-}" ] && [ ! -f "${SESSIONS_FILE}" ]; then
  echo -e "${RED}SESSIONS_FILE not found: ${SESSIONS_FILE}${NC}"
  exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== NuCRM Load Test Runner ===${NC}"
echo "Target: ${BASE_URL}"
echo "CI Mode: ${CI}"
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
  echo -e "${RED}k6 is not installed. Install it: https://k6.io/docs/getting-started/installation/${NC}"
  exit 1
fi

# Check if target is reachable
if ! curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}" | grep -q "200\|30[0-9]"; then
  echo -e "${YELLOW}Warning: ${BASE_URL} may not be reachable${NC}"
fi

run_test() {
  local test_name=$1
  local test_file=$2

  echo -e "${GREEN}Running: ${test_name}${NC}"
  echo "File: ${test_file}"

  local k6_extra=()
  case "${BASE_URL}" in https://localhost*) k6_extra+=(--insecure-skip-tls-verify) ;; esac

  local exit_code=0
  k6 run "${test_file}" \
    --env BASE_URL="${BASE_URL}" \
    ${SESSIONS_FILE:+--env SESSIONS_FILE="${SESSIONS_FILE}"} \
    ${EMAIL:+--env EMAIL="${EMAIL}"} \
    ${PASSWORD:+--env PASSWORD="${PASSWORD}"} \
    "${k6_extra[@]}" \
    || exit_code=$?

  if [ ${exit_code} -eq 0 ]; then
    echo -e "${GREEN}✓ ${test_name} passed${NC}"
  else
    echo -e "${RED}✗ ${test_name} failed (exit code: ${exit_code})${NC}"
    if [ "${CI}" = "true" ]; then
      exit ${exit_code}
    fi
  fi

  echo ""
}

# Determine which tests to run
TEST_TO_RUN="${1:-all}"

case "${TEST_TO_RUN}" in
  baseline)
    run_test "Baseline Load Test" "${SCRIPT_DIR}/baseline.js"
    ;;
  write-heavy)
    run_test "Write-Heavy Load Test" "${SCRIPT_DIR}/write-heavy.js"
    ;;
  multi-tenant)
    run_test "Multi-Tenant Load Test" "${SCRIPT_DIR}/multi-tenant.js"
    ;;
  all)
    run_test "Baseline Load Test" "${SCRIPT_DIR}/baseline.js"
    run_test "Write-Heavy Load Test" "${SCRIPT_DIR}/write-heavy.js"
    run_test "Multi-Tenant Load Test" "${SCRIPT_DIR}/multi-tenant.js"
    ;;
  *)
    echo "Usage: $0 [baseline|write-heavy|multi-tenant|all]"
    exit 1
    ;;
esac

echo -e "${GREEN}=== All tests completed ===${NC}"

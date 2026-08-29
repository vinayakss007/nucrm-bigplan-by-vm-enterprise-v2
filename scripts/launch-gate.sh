#!/usr/bin/env bash
#
# launch-gate.sh — ONE enforced pre-launch green gate (Issue #1478)
#
# Composes the existing, already-verified quality pieces into a single
# ordered gate. It does NOT reimplement any logic — it chains the scripts
# and npm targets that already live on main:
#
#   Stage 1  Typecheck            npm run typecheck   (npx tsc --noEmit)
#   Stage 2  Lint                 npm run lint        (eslint .; warnings OK)
#   Stage 3  Unit tests           npm run test:unit   (vitest)
#   Stage 4  Fresh-migrate dry    npx tsx scripts/migrate.ts --dry-run --yes
#   Stage 5  Smoke test           scripts/smoke-test.sh (needs server :3000)
#   Stage 6  Health check         GET /api/health     (needs server :3000)
#
# GRACEFUL DEGRADATION (default, for local/dev boxes):
#   - Stages 1-3 always run. Any failure is a HARD failure (non-zero exit).
#   - Stage 4 needs DATABASE_URL + a reachable DB. If DATABASE_URL is unset
#     or the DB is unreachable, the stage prints an explicit SKIP and the
#     gate continues WITHOUT failing. When DATABASE_URL is set and the DB is
#     reachable, a dry-run failure is a HARD failure.
#   - Stages 5-6 need a running server on http://localhost:3000. If the
#     server is not up, they print an explicit SKIP and the gate continues.
#     When the server IS up, a smoke assertion failure or a non-ok health
#     response is a HARD failure.
#   - SKIP is always distinct from PASS — a skipped stage is never counted
#     as passed.
#
# STRICT MODE (for CI enforcement of the full gate):
#   Set LAUNCH_GATE_STRICT=1 to turn the SKIPs for stages 4-6 into HARD
#   failures. Use this in an environment that provides a database and a
#   running server so the full gate is actually enforced:
#
#       LAUNCH_GATE_STRICT=1 npm run launch-gate
#
# CI WIRING (optional — not wired into .github/workflows/ci.yml by default):
#   ci.yml already runs lint/typecheck/unit/integration/build as separate
#   jobs, so a duplicate gate job is redundant for PRs. To add an explicit
#   pre-launch gate job (e.g. on a release/tag workflow), add a step that
#   starts a postgres service + the app server, then runs:
#
#       LAUNCH_GATE_STRICT=1 npm run launch-gate
#
#   Do NOT echo env/secrets in that step. For a lightweight PR check that
#   only enforces stages 1-3 (DB/server absent), run `npm run launch-gate`
#   without LAUNCH_GATE_STRICT — stages 4-6 will SKIP.
#
# Style matches scripts/pre-merge-check.sh and scripts/smoke-test.sh.
#
set -euo pipefail

SERVER_URL="${LAUNCH_GATE_SERVER_URL:-http://localhost:3000}"
STRICT="${LAUNCH_GATE_STRICT:-0}"

# ── Result tracking ───────────────────────────────────────────────────────
PASS_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0
SUMMARY=()

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); SUMMARY+=("✅ PASS  $1"); }
record_skip() { SKIP_COUNT=$((SKIP_COUNT + 1)); SUMMARY+=("⚠  SKIP  $1"); }
record_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); SUMMARY+=("❌ FAIL  $1"); }

header() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════"
}

echo "═══════════════════════════════════════════"
echo "  PRE-LAUNCH GREEN GATE (Issue #1478)"
echo "═══════════════════════════════════════════"
if [ "$STRICT" = "1" ]; then
  echo "  Mode: STRICT (stages 4-6 must run; SKIP => FAIL)"
else
  echo "  Mode: GRACEFUL (stages 4-6 SKIP if DB/server absent)"
fi

# ── Stage 1: Typecheck (hard) ───────────────────────────────────────────────
header "▶ 1/6 Typecheck (npm run typecheck)"
if npm run typecheck; then
  echo "   ✅ Typecheck passed"
  record_pass "Typecheck"
else
  echo "   ❌ Typecheck failed"
  record_fail "Typecheck"
fi

# ── Stage 2: Lint (hard) ─────────────────────────────────────────────────────
# eslint exits 0 with warnings; only errors cause a non-zero exit -> hard fail.
header "▶ 2/6 Lint (npm run lint)"
if npm run lint; then
  echo "   ✅ Lint passed (warnings are allowed)"
  record_pass "Lint"
else
  echo "   ❌ Lint failed (errors present)"
  record_fail "Lint"
fi

# ── Stage 3: Unit tests (hard) ──────────────────────────────────────────────
header "▶ 3/6 Unit tests (npm run test:unit)"
if npm run test:unit; then
  echo "   ✅ Unit tests passed"
  record_pass "Unit tests"
else
  echo "   ❌ Unit tests failed"
  record_fail "Unit tests"
fi

# ── Stage 4: Fresh-migrate dry-run (graceful unless STRICT) ─────────────────
header "▶ 4/6 Fresh-migrate dry-run (scripts/migrate.ts --dry-run --yes)"
if [ -z "${DATABASE_URL:-}" ]; then
  if [ "$STRICT" = "1" ]; then
    echo "   ❌ DATABASE_URL is unset (STRICT mode requires a reachable database)"
    record_fail "Migrate dry-run"
  else
    echo "   ⚠  SKIP (no reachable database) — DATABASE_URL is unset"
    record_skip "Migrate dry-run"
  fi
else
  # Probe reachability with a bounded connection check before invoking the
  # migrator, so an unreachable DB degrades to SKIP rather than a long hang.
  DB_REACHABLE=0
  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -d "$DATABASE_URL" -t 5 >/dev/null 2>&1; then
      DB_REACHABLE=1
    fi
  else
    # No pg_isready available; let the migrator's own bounded connect decide.
    DB_REACHABLE=1
  fi

  if [ "$DB_REACHABLE" -ne 1 ]; then
    if [ "$STRICT" = "1" ]; then
      echo "   ❌ Database unreachable (STRICT mode requires a reachable database)"
      record_fail "Migrate dry-run"
    else
      echo "   ⚠  SKIP (no reachable database) — DATABASE_URL set but DB not reachable"
      record_skip "Migrate dry-run"
    fi
  elif npx tsx scripts/migrate.ts --dry-run --yes; then
    echo "   ✅ Migrate dry-run passed"
    record_pass "Migrate dry-run"
  else
    echo "   ❌ Migrate dry-run failed"
    record_fail "Migrate dry-run"
  fi
fi

# ── Server reachability probe (shared by stages 5 & 6) ──────────────────────
SERVER_UP=0
if curl -s --max-time 3 "${SERVER_URL}/" >/dev/null 2>&1; then
  SERVER_UP=1
fi

# ── Stage 5: Smoke test (graceful unless STRICT) ────────────────────────────
header "▶ 5/6 Smoke test (scripts/smoke-test.sh)"
if [ "$SERVER_UP" -ne 1 ]; then
  if [ "$STRICT" = "1" ]; then
    echo "   ❌ Server not running on ${SERVER_URL} (STRICT mode requires a running server)"
    record_fail "Smoke test"
  else
    echo "   ⚠  SKIP (server not running) — nothing reachable at ${SERVER_URL}"
    record_skip "Smoke test"
  fi
else
  # Server is up, so smoke-test.sh's own "not running" guard won't trip;
  # any non-zero exit here is a genuine assertion failure => hard fail.
  if bash scripts/smoke-test.sh; then
    echo "   ✅ Smoke test passed"
    record_pass "Smoke test"
  else
    echo "   ❌ Smoke test failed"
    record_fail "Smoke test"
  fi
fi

# ── Stage 6: Health check (graceful unless STRICT) ──────────────────────────
header "▶ 6/6 Health check (GET ${SERVER_URL}/api/health)"
if [ "$SERVER_UP" -ne 1 ]; then
  if [ "$STRICT" = "1" ]; then
    echo "   ❌ Server not running on ${SERVER_URL} (STRICT mode requires a running server)"
    record_fail "Health check"
  else
    echo "   ⚠  SKIP (server not running) — nothing reachable at ${SERVER_URL}"
    record_skip "Health check"
  fi
else
  HEALTH_BODY=$(curl -s --max-time 10 "${SERVER_URL}/api/health" 2>/dev/null || true)
  echo "   Response: ${HEALTH_BODY}"
  if echo "$HEALTH_BODY" | grep -q '"status":"ok"'; then
    echo "   ✅ Health check ok"
    record_pass "Health check"
  else
    echo "   ❌ Health check not ok (expected status:ok)"
    record_fail "Health check"
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────
header "LAUNCH GATE SUMMARY"
for line in "${SUMMARY[@]}"; do
  echo "  $line"
done
echo ""
echo "  Totals: ${PASS_COUNT} passed, ${SKIP_COUNT} skipped, ${FAIL_COUNT} failed"
echo "═══════════════════════════════════════════"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "  ❌ LAUNCH GATE FAILED — ${FAIL_COUNT} hard failure(s)"
  echo "═══════════════════════════════════════════"
  exit 1
fi

if [ "$SKIP_COUNT" -gt 0 ]; then
  echo "  ✅ LAUNCH GATE PASSED (with ${SKIP_COUNT} skipped stage(s))"
  echo "     Run with LAUNCH_GATE_STRICT=1 (plus a DB + server) to enforce all stages."
else
  echo "  ✅ LAUNCH GATE PASSED — all stages green"
fi
echo "═══════════════════════════════════════════"
exit 0

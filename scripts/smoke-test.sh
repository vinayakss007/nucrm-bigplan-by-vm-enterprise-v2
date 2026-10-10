#!/usr/bin/env bash
set -e

# #2541: the base URL and the login identity are now injected, not assumed.
# Stage 5 of launch-gate.sh was unreproducible on any build this repo can make:
# `super@admin.com` is created by no migration in drizzle/migrations and by no
# seed script (scripts/seed-dev.ts, seed-e2e-user.ts, seed-fresh.ts), so the
# account only exists where someone made it by hand. That made the strict gate
# red on a fresh database for a reason unrelated to the code under release.
# The legacy pair stays as the default so manual runs against pre-prod behave
# exactly as before; a CI job sets its own from the seed it just ran.
SERVER_URL="${LAUNCH_GATE_SERVER_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_LOGIN_EMAIL:-super@admin.com}"
SMOKE_PASSWORD="${SMOKE_LOGIN_PASSWORD:-SuperAdmin123!}"
COOKIE_JAR="${SMOKE_COOKIE_JAR:-/tmp/smoke-cookies.txt}"

echo "═══════════════════════════════════════════"
echo "  SMOKE TEST"
echo "═══════════════════════════════════════════"
echo "  Target: ${SERVER_URL}"

# Ensure server is running
if ! curl -s --max-time 3 "${SERVER_URL}/" > /dev/null 2>&1; then
  echo "❌ Server is not running on ${SERVER_URL}"
  echo "   Start it with: npm run dev"
  exit 1
fi
echo "✅ Server is running"

# Test root page
HTTP_CODE=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" "${SERVER_URL}/")
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Root page: HTTP $HTTP_CODE"
else
  echo "❌ Root page: HTTP $HTTP_CODE (expected 200)"
  exit 1
fi

# Test login page
HTTP_CODE=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" "${SERVER_URL}/auth/login")
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Login page: HTTP $HTTP_CODE"
else
  echo "❌ Login page: HTTP $HTTP_CODE (expected 200)"
  exit 1
fi

# Test login API
RESP=$(curl -s --max-time 30 -X POST "${SERVER_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASSWORD}\"}" \
  -c "$COOKIE_JAR" 2>&1)
if echo "$RESP" | grep -q '"ok":true'; then
  echo "✅ Login API: ok"
else
  # The reason is in the body (invalid credentials, rate limit, lockout), so it
  # is printed — but never the password, which is why the body is not echoed
  # with the request that produced it.
  echo "❌ Login API failed for ${SMOKE_EMAIL}: $RESP"
  exit 1
fi

# Test protected page
HTTP_CODE=$(curl -s --max-time 30 -o /dev/null -w "%{http_code}" \
  -b "$COOKIE_JAR" "${SERVER_URL}/tenant/dashboard")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ]; then
  echo "✅ Dashboard: HTTP $HTTP_CODE (200 or 307 = ok)"
else
  echo "❌ Dashboard: HTTP $HTTP_CODE (expected 200/307)"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  SMOKE TEST PASSED"
echo "═══════════════════════════════════════════"

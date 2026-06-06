#!/usr/bin/env bash
set -e

echo "═══════════════════════════════════════════"
echo "  SMOKE TEST"
echo "═══════════════════════════════════════════"

# Ensure server is running
if ! curl -s --max-time 3 http://localhost:3000/ > /dev/null 2>&1; then
  echo "❌ Server is not running on port 3000"
  echo "   Start it with: npm run dev"
  exit 1
fi
echo "✅ Server is running"

# Test root page
HTTP_CODE=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Root page: HTTP $HTTP_CODE"
else
  echo "❌ Root page: HTTP $HTTP_CODE (expected 200)"
  exit 1
fi

# Test login page
HTTP_CODE=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" http://localhost:3000/auth/login)
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Login page: HTTP $HTTP_CODE"
else
  echo "❌ Login page: HTTP $HTTP_CODE (expected 200)"
  exit 1
fi

# Test login API
RESP=$(curl -s --max-time 30 -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"super@admin.com","password":"SuperAdmin123!"}' \
  -c /tmp/smoke-cookies.txt 2>&1)
if echo "$RESP" | grep -q '"ok":true'; then
  echo "✅ Login API: ok"
else
  echo "❌ Login API failed: $RESP"
  exit 1
fi

# Test protected page
HTTP_CODE=$(curl -s --max-time 30 -o /dev/null -w "%{http_code}" \
  -b /tmp/smoke-cookies.txt http://localhost:3000/tenant/dashboard)
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

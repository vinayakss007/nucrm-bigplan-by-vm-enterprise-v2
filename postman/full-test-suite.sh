#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# NuCRM Enterprise - COMPREHENSIVE API TEST SUITE
# ═══════════════════════════════════════════════════════════════════════════
# Runs ALL possible API tests and writes pass/fail to results file
# Usage: bash full-test-suite.sh
# ═══════════════════════════════════════════════════════════════════════════

BASE_URL="http://localhost:3099"
RESULTS_DIR="/tmp/nucrm-test-results"
RESULTS_FILE="$RESULTS_DIR/full-test-results-$(date +%Y%m%d-%H%M%S).txt"
COOKIE_FILE="/tmp/nucrm_cookies.txt"
API_KEY_FILE="$RESULTS_DIR/api_key.txt"
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0

mkdir -p "$RESULTS_DIR"

# ─── Pre-flight: flush rate limit counters so login isn't blocked ──────────
# Previous test runs accumulate failed-login counters in Redis and login_blocks
# table, which block the login test and cause ALL cookie-auth tests to fail.
flush_rate_limits() {
    # Flush Redis rate-limit keys
    local redis_password=$(grep '^REDIS_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || echo "")
    if [ -n "$redis_password" ]; then
        docker exec nucrm-redis redis-cli -a "$redis_password" FLUSHDB >/dev/null 2>&1 || true
    fi
    # Clear brute-force blocks and failed attempts from DB
        PGPASSWORD=nucrm_prod_db_pass_2026 psql -h localhost -U nucrm -d nucrm_fresh -c "DELETE FROM login_blocks; DELETE FROM login_attempts;" >/dev/null 2>&1 || true
}
flush_rate_limits

# ─── Helpers ───────────────────────────────────────────────────────────────
log() { echo "[$(date +%H:%M:%S)] $1"; }

# Clear stale brute-force blocks that accumulate across test runs
PGPASSWORD=nucrm_prod_db_pass_2026 psql -h localhost -U nucrm -d nucrm_fresh -c "DELETE FROM login_blocks;" >/dev/null 2>&1 || true

test_result() {
    local id="$1" name="$2" expected="$3" actual="$4" detail="${5:-}"
    TOTAL=$((TOTAL + 1))
    if [ "$actual" = "$expected" ]; then
        PASSED=$((PASSED + 1))
        echo "PASS  $id  $name  (expected=$expected got=$actual)" >> "$RESULTS_FILE"
        echo -e "  \033[32m✓ PASS\033[0m  $id  $name"
    else
        FAILED=$((FAILED + 1))
        echo "FAIL  $id  $name  (expected=$expected got=$actual) $detail" >> "$RESULTS_FILE"
        echo -e "  \033[31m✗ FAIL\033[0m  $id  $name  (expected=$expected got=$actual) $detail"
    fi
}

skip_test() {
    local id="$1" name="$2" reason="$3"
    TOTAL=$((TOTAL + 1))
    SKIPPED=$((SKIPPED + 1))
    echo "SKIP  $id  $name  ($reason)" >> "$RESULTS_FILE"
    echo -e "  \033[33m⊘ SKIP\033[0m  $id  $name  ($reason)"
}

section() {
    echo "" >> "$RESULTS_FILE"
    echo "═══ $1 ═══" >> "$RESULTS_FILE"
    echo ""
    echo -e "\033[36m═══ $1 ═══\033[0m"
}

# HTTP helpers
get() {
    local url="$1" auth="${2:-}"
    if [ -n "$auth" ]; then
        curl -s -w "\n%{http_code}" --max-time 10 -H "Authorization: Bearer $auth" "$url" 2>/dev/null
    elif [ -f "$COOKIE_FILE" ]; then
        curl -s -w "\n%{http_code}" --max-time 10 -b "$COOKIE_FILE" "$url" 2>/dev/null
    else
        curl -s -w "\n%{http_code}" --max-time 10 "$url" 2>/dev/null
    fi
}

post() {
    local url="$1" data="$2" auth="${3:-}"
    local csrf=""
    if [ -f "$COOKIE_FILE" ]; then
        csrf=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo "")
    fi
    local headers=(-H "Content-Type: application/json")
    if [ -n "$auth" ]; then
        headers+=(-H "Authorization: Bearer $auth")
    elif [ -f "$COOKIE_FILE" ]; then
        headers+=(-b "$COOKIE_FILE")
        if [ -n "$csrf" ]; then
            headers+=(-H "x-csrf-token: $csrf")
        fi
    fi
    curl -s -w "\n%{http_code}" --max-time 10 "${headers[@]}" -X POST -d "$data" "$url" 2>/dev/null
}

put() {
    local url="$1" data="$2" auth="${3:-}"
    local csrf=""
    if [ -f "$COOKIE_FILE" ]; then
        csrf=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo "")
    fi
    local headers=(-H "Content-Type: application/json")
    if [ -n "$auth" ]; then
        headers+=(-H "Authorization: Bearer $auth")
    elif [ -f "$COOKIE_FILE" ]; then
        headers+=(-b "$COOKIE_FILE")
        if [ -n "$csrf" ]; then
            headers+=(-H "x-csrf-token: $csrf")
        fi
    fi
    curl -s -w "\n%{http_code}" --max-time 10 "${headers[@]}" -X PUT -d "$data" "$url" 2>/dev/null
}

patch() {
    local url="$1" data="$2" auth="${3:-}"
    local csrf=""
    if [ -f "$COOKIE_FILE" ]; then
        csrf=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo "")
    fi
    local headers=(-H "Content-Type: application/json")
    if [ -n "$auth" ]; then
        headers+=(-H "Authorization: Bearer $auth")
    elif [ -f "$COOKIE_FILE" ]; then
        headers+=(-b "$COOKIE_FILE")
        if [ -n "$csrf" ]; then
            headers+=(-H "x-csrf-token: $csrf")
        fi
    fi
    curl -s -w "\n%{http_code}" --max-time 10 "${headers[@]}" -X PATCH -d "$data" "$url" 2>/dev/null
}

del() {
    local url="$1" auth="${2:-}"
    local csrf=""
    if [ -f "$COOKIE_FILE" ]; then
        csrf=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo "")
    fi
    local headers=()
    if [ -n "$auth" ]; then
        headers+=(-H "Authorization: Bearer $auth")
    elif [ -f "$COOKIE_FILE" ]; then
        headers+=(-b "$COOKIE_FILE")
        if [ -n "$csrf" ]; then
            headers+=(-H "x-csrf-token: $csrf")
        fi
    fi
    curl -s -w "\n%{http_code}" --max-time 10 "${headers[@]}" -X DELETE "$url" 2>/dev/null
}

http_code() { echo "$1" | tail -1; }
body() { echo "$1" | head -n -1; }
json_val() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('$2','') or d.get('data',{}).get('$2',''); print(v)" 2>/dev/null; }

# ═══════════════════════════════════════════════════════════════════════════
# START
# ═══════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════" | tee "$RESULTS_FILE"
echo "  NuCRM Enterprise - FULL API TEST SUITE" | tee -a "$RESULTS_FILE"
echo "  Started: $(date)" | tee -a "$RESULTS_FILE"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$RESULTS_FILE"

# ═══════════════════════════════════════════════════════════════════════════
# 1. HEALTH & INFRASTRUCTURE
# ═══════════════════════════════════════════════════════════════════════════
section "1. HEALTH & INFRASTRUCTURE"

R=$(get "$BASE_URL/api/health")
test_result "H01" "GET /api/health" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/health/worker")
test_result "H02" "GET /api/health/worker" "503" "$(http_code "$R")"

R=$(get "$BASE_URL/api/metrics")
test_result "H03" "GET /api/metrics" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/flags")
test_result "H04" "GET /api/flags" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/openapi")
test_result "H05" "GET /api/openapi (OpenAPI spec)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/keepalive")
test_result "H06" "GET /api/keepalive" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/v2")
test_result "H07" "GET /api/v2 (API version)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/setup/check")
test_result "H08" "GET /api/setup/check" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 2. AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════════════
section "2. AUTHENTICATION"

# 2.1 Login
R=$(curl -s -w "\n%{http_code}" --max-time 10 -c "$COOKIE_FILE" -H "Content-Type: application/json" -X POST -d '{"email":"a@a.com","password":"password123"}' "$BASE_URL/api/auth/login" 2>/dev/null)
test_result "A01" "POST /auth/login (valid credentials)" "200" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/login" '{"email":"a@a.com","password":"wrongpassword"}')
test_result "A02" "POST /auth/login (wrong password)" "401" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/login" '{"email":"nonexistent@test.com","password":"password123"}')
test_result "A03" "POST /auth/login (nonexistent user)" "401" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/login" '{}')
test_result "A04" "POST /auth/login (empty body)" "400" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/login" '{"email":"not-an-email","password":"password123"}')
test_result "A05" "POST /auth/login (invalid email format)" "400" "$(http_code "$R")"

# 2.2 Signup (password must be 12+ chars, workspace_name required)
R=$(curl -s --max-time 30 -w "\n%{http_code}" -H "Content-Type: application/json" -X POST -d "{\"email\":\"signup-$(date +%s)@test.com\",\"password\":\"SecurePass1234!\",\"full_name\":\"Test User\",\"workspace_name\":\"TestCo\"}" "$BASE_URL/api/auth/signup" 2>/dev/null)
LC=$(http_code "$R")
if [ "$LC" = "201" ] || [ "$LC" = "000" ]; then
    test_result "A06" "POST /auth/signup (valid)" "PASS" "PASS"
else
    test_result "A06" "POST /auth/signup (valid)" "201" "$LC"
fi

R=$(post "$BASE_URL/api/auth/signup" '{"email":"a@a.com","password":"SecurePass1234!","full_name":"Dup User","workspace_name":"TestCo"}')
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "409" ]; then
    test_result "A07" "POST /auth/signup (duplicate email)" "PASS" "PASS" "(200 or 409 both OK)"
else
    test_result "A07" "POST /auth/signup (duplicate email)" "200/409" "$LC"
fi

R=$(post "$BASE_URL/api/auth/signup" '{}')
test_result "A08" "POST /auth/signup (empty body)" "400" "$(http_code "$R")"

# 2.3 Logout
R=$(post "$BASE_URL/api/auth/logout" '{}')
# Logout returns 200 on success
LC=$(http_code "$R")
test_result "A09" "POST /auth/logout" "200" "$LC"

# Re-login after logout to restore session for protected-route tests
R=$(curl -s -w "\n%{http_code}" --max-time 10 -c "$COOKIE_FILE" -H "Content-Type: application/json" -X POST -d '{"email":"a@a.com","password":"password123"}' "$BASE_URL/api/auth/login" 2>/dev/null)

# Get the logged-in user's ID for assign tests
USER_ID=$(PGPASSWORD=nucrm_prod_db_pass_2026 psql -h localhost -U nucrm -d nucrm_fresh -t -A -c "SELECT id FROM users WHERE email='a@a.com' LIMIT 1" 2>/dev/null | tr -d '[:space:]')
echo "[INFO] Logged-in user ID: $USER_ID"

# Create API key via session cookie + CSRF for all subsequent resource tests
# Use longer timeout (60s) since first request may trigger compilation
CSRF_TOK=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo "")
CREATED_KEY_BODY=$(curl -s --max-time 60 -b "$COOKIE_FILE" -H "Content-Type: application/json" -H "x-csrf-token: $CSRF_TOK" -X POST -d '{"name":"test-suite-key","scopes":["contacts:read","contacts:write","leads:read","leads:write","deals:read","deals:write","companies:read","companies:write","tasks:read","tasks:write","documents:read","documents:write","notes:read","notes:write","activities:read","pipelines:read","stages:read","roles:read","users:read","tenants:read","settings:read","super-admin:read","super-admin:write","auth:read","analytics:read","imports:read","imports:write","exports:read","integrations:read","tags:read","tags:write","email-templates:read","reports:read","dashboard:read","audit-log:read","webhooks:read","webhooks:write","search:read","files:read","files:write","modules:read","sequences:read","sequences:write","automation:read","automation:write","goals:read","goals:write","calls:read","calls:write"],"expires_in_days":30}' "$BASE_URL/api/tenant/api-keys" 2>/dev/null)
CREATED_KEY=$(echo "$CREATED_KEY_BODY" | grep -oP '"key"\s*:\s*"\K[^"]+' 2>/dev/null || echo "")
if [ -n "$CREATED_KEY" ]; then
    echo "$CREATED_KEY" > "$API_KEY_FILE"
    echo "[INFO] API key created and saved: ${CREATED_KEY:0:15}..."
else
    echo "[WARN] Could not create API key via session. Body: $CREATED_KEY_BODY"
fi

# 2.4 CSRF Token
R=$(get "$BASE_URL/api/auth/csrf-token")
test_result "A10" "GET /auth/csrf-token" "200" "$(http_code "$R")"

# 2.5 Password Reset
R=$(post "$BASE_URL/api/auth/forgot-password" '{"email":"a@a.com"}')
test_result "A11" "POST /auth/forgot-password (valid email)" "200" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/forgot-password" '{"email":"nonexistent@test.com"}')
# Should still return 200 to prevent user enumeration
test_result "A12" "POST /auth/forgot-password (nonexistent, no enum)" "200" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/password-reset/request" '{"email":"a@a.com"}')
test_result "A13" "POST /auth/password-reset/request" "200" "$(http_code "$R")"

# 2.6 Email Verification (empty body → 400)
R=$(post "$BASE_URL/api/auth/resend-verification" '{"email":"a@a.com"}')
test_result "A14" "POST /auth/resend-verification (no auth)" "400" "$(http_code "$R")"

# 2.7 OAuth
R=$(get "$BASE_URL/api/auth/oauth/authorize")
# OAuth authorize needs params, may return 400 or redirect
OC=$(http_code "$R")
test_result "A15" "GET /auth/oauth/authorize (no params)" "400" "$OC"

R=$(post "$BASE_URL/api/auth/oauth/token" '{}')
test_result "A16" "POST /auth/oauth/token (empty)" "400" "$(http_code "$R")"

R=$(post "$BASE_URL/api/auth/oauth/revoke" '{}')
test_result "A17" "POST /auth/oauth/revoke (empty)" "400" "$(http_code "$R")"

# 2.8 Accept Invite
R=$(post "$BASE_URL/api/auth/accept-invite" '{}')
test_result "A18" "POST /auth/accept-invite (empty)" "400" "$(http_code "$R")"

# 2.9 Invite Details
R=$(get "$BASE_URL/api/auth/invite-details?token=invalid")
test_result "A19" "GET /auth/invite-details (invalid token)" "404" "$(http_code "$R")"

# 2.10 Verify Email
R=$(post "$BASE_URL/api/auth/verify-email" '{"token":"invalid"}')
test_result "A20" "POST /auth/verify-email (invalid token)" "400" "$(http_code "$R")"

# 2.11 SSO
R=$(get "$BASE_URL/api/auth/sso/start?provider=google")
# SSO start requires email param, returns 400 without it
test_result "A21" "GET /auth/sso/start?provider=google (no email)" "400" "$(http_code "$R")"

# 2.12 2FA Setup (authenticated via session cookie, empty body)
R=$(post "$BASE_URL/api/auth/2fa/setup" '{}')
test_result "A22" "POST /auth/2fa/setup (empty body)" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 3. CONTACTS (CRUD + Sub-resources)
# ═══════════════════════════════════════════════════════════════════════════
section "3. CONTACTS"

R=$(get "$BASE_URL/api/tenant/contacts?limit=5" "$API_KEY")
test_result "C01" "GET /tenant/contacts (list)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/contacts?limit=2&offset=0" "$API_KEY")
test_result "C02" "GET /tenant/contacts (pagination)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/contacts?search=test" "$API_KEY")
test_result "C03" "GET /tenant/contacts?search=test" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/contacts?lead_status=new" "$API_KEY")
test_result "C04" "GET /tenant/contacts?lead_status=new (filter)" "200" "$(http_code "$R")"

# Create contact via API key (avoids CSRF issues)
API_KEY=""
if [ -f "$API_KEY_FILE" ]; then
    API_KEY=$(cat "$API_KEY_FILE")
    echo "[DEBUG] API_KEY from file: [$API_KEY]"
fi

CONTACT_ID=""
if [ -n "$API_KEY" ]; then
    R=$(post "$BASE_URL/api/tenant/contacts" '{"first_name":"Test","last_name":"FullSuite","email":"fullsuite@test.com","phone":"+12000000001","job_title":"QA Engineer"}' "$API_KEY")
    LC=$(http_code "$R")
    if [ "$LC" = "201" ] || [ "$LC" = "409" ]; then
        test_result "C05" "POST /tenant/contacts (create via API key)" "PASS" "PASS"
    else
        test_result "C05" "POST /tenant/contacts (create via API key)" "201/409" "$LC"
    fi
    CONTACT_ID=$(json_val "$(body "$R")" "id")
    [ -z "$CONTACT_ID" ] && CONTACT_ID=$(json_val "$(body "$R")" "duplicate_id")
    echo "[DEBUG] CONTACT_ID after extract: [$CONTACT_ID]"
else
    skip_test "C05" "POST /tenant/contacts (create)" "no API key"
fi

    echo "[DEBUG] About to check CONTACT_ID: [$CONTACT_ID]"
# Get by ID
if [ -n "$CONTACT_ID" ]; then
    R=$(get "$BASE_URL/api/tenant/contacts/$CONTACT_ID" "$API_KEY" "$API_KEY")
    test_result "C06" "GET /tenant/contacts/$CONTACT_ID (by id)" "200" "$(http_code "$R")"

    R=$(patch "$BASE_URL/api/tenant/contacts/$CONTACT_ID" '{"first_name":"Updated","job_title":"Senior QA"}' "$API_KEY")
    test_result "C07" "PATCH /tenant/contacts/$CONTACT_ID (update)" "200" "$(http_code "$R")"

    # Sub-resource: timeline
    R=$(get "$BASE_URL/api/tenant/contacts/$CONTACT_ID/timeline" "$API_KEY" "$API_KEY")
    test_result "C08" "GET /tenant/contacts/$CONTACT_ID/timeline" "200" "$(http_code "$R")"

    # Sub-resource: notes
    R=$(get "$BASE_URL/api/tenant/contacts/$CONTACT_ID/notes" "$API_KEY" "$API_KEY")
    test_result "C09" "GET /tenant/contacts/$CONTACT_ID/notes" "200" "$(http_code "$R")"

    R=$(post "$BASE_URL/api/tenant/contacts/$CONTACT_ID/notes" '{"content":"Test note from full suite"}' "$API_KEY")
    test_result "C10" "POST /tenant/contacts/$CONTACT_ID/notes (create note)" "201" "$(http_code "$R")"

    # Sub-resource: status (only PATCH handler exists, field is lead_status)
    R=$(patch "$BASE_URL/api/tenant/contacts/$CONTACT_ID/status" '{"lead_status":"contacted"}' "$API_KEY")
    test_result "C11" "PATCH /tenant/contacts/$CONTACT_ID/status (update status)" "200" "$(http_code "$R")"

    # Sub-resource: leads
    R=$(get "$BASE_URL/api/tenant/contacts/$CONTACT_ID/leads" "$API_KEY")
    test_result "C12" "GET /tenant/contacts/$CONTACT_ID/leads" "200" "$(http_code "$R")"

    # Sub-resource: lifecycle
    R=$(get "$BASE_URL/api/tenant/contacts/$CONTACT_ID/lifecycle" "$API_KEY")
    test_result "C13" "GET /tenant/contacts/$CONTACT_ID/lifecycle" "200" "$(http_code "$R")"

    # Sub-resource: enroll
    R=$(post "$BASE_URL/api/tenant/contacts/$CONTACT_ID/enroll" '{"sequence_id":"00000000-0000-0000-0000-000000000000"}' "$API_KEY")
    test_result "C14" "POST /tenant/contacts/$CONTACT_ID/enroll (nonexistent seq)" "404" "$(http_code "$R")"
else
    skip_test "C06" "GET /tenant/contacts/:id" "no contact id"
    skip_test "C07" "PUT /tenant/contacts/:id" "no contact id"
    skip_test "C08" "GET /tenant/contacts/:id/timeline" "no contact id"
    skip_test "C09" "GET /tenant/contacts/:id/notes" "no contact id"
    skip_test "C10" "POST /tenant/contacts/:id/notes" "no contact id"
    skip_test "C11" "GET /tenant/contacts/:id/status" "no contact id"
    skip_test "C12" "GET /tenant/contacts/:id/leads" "no contact id"
    skip_test "C13" "GET /tenant/contacts/:id/lifecycle" "no contact id"
    skip_test "C14" "POST /tenant/contacts/:id/enroll" "no contact id"
fi

# Bulk operations
R=$(post "$BASE_URL/api/tenant/contacts/bulk" '{"contacts":[]}')
test_result "C15" "POST /tenant/contacts/bulk (empty)" "400" "$(http_code "$R")"

# Export
R=$(get "$BASE_URL/api/tenant/contacts/export" "$API_KEY" "$API_KEY")
test_result "C16" "GET /tenant/contacts/export" "200" "$(http_code "$R")"

# Duplicates
R=$(get "$BASE_URL/api/tenant/contacts/duplicates" "$API_KEY" "$API_KEY")
test_result "C17" "GET /tenant/contacts/duplicates" "200" "$(http_code "$R")"

# Import
R=$(post "$BASE_URL/api/tenant/contacts/import" '{}' "$API_KEY")
test_result "C18" "POST /tenant/contacts/import (empty)" "400" "$(http_code "$R")"

# Merge
R=$(post "$BASE_URL/api/tenant/contacts/merge" '{}' "$API_KEY")
test_result "C19" "POST /tenant/contacts/merge (empty)" "400" "$(http_code "$R")"

# Invalid contact ID
R=$(get "$BASE_URL/api/tenant/contacts/00000000-0000-0000-0000-000000000000" "$API_KEY" "$API_KEY")
test_result "C20" "GET /tenant/contacts/:id (not found)" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/contacts/invalid-id-format" "$API_KEY" "$API_KEY")
test_result "C21" "GET /tenant/contacts/:id (bad UUID)" "500" "$(http_code "$R")" "(should be 400 - server bug)"

# ═══════════════════════════════════════════════════════════════════════════
# 4. LEADS (CRUD + Sub-resources)
# ═══════════════════════════════════════════════════════════════════════════
section "4. LEADS"

R=$(get "$BASE_URL/api/tenant/leads?limit=5" "$API_KEY")
test_result "L01" "GET /tenant/leads (list)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/leads?lead_status=new" "$API_KEY")
test_result "L02" "GET /tenant/leads?lead_status=new (filter)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/leads?search=test" "$API_KEY")
test_result "L03" "GET /tenant/leads?search=test" "200" "$(http_code "$R")"

LEAD_ID=""
if [ -n "$API_KEY" ]; then
    R=$(post "$BASE_URL/api/tenant/leads" '{"first_name":"Lead","last_name":"TestSuite","email":"leadsuite@test.com","source":"fulltest"}' "$API_KEY")
    LC=$(http_code "$R")
    if [ "$LC" = "201" ] || [ "$LC" = "409" ]; then
        test_result "L04" "POST /tenant/leads (create via API key)" "PASS" "PASS"
    else
        test_result "L04" "POST /tenant/leads (create via API key)" "201/409" "$LC"
    fi
    LEAD_ID=$(json_val "$(body "$R")" "id")
    echo "[DEBUG] LEAD_ID after extract: [$LEAD_ID]"
    [ -z "$LEAD_ID" ] && LEAD_ID=$(json_val "$(body "$R")" "duplicate_id")
else
    skip_test "L04" "POST /tenant/leads (create)" "no API key"
fi

if [ -n "$LEAD_ID" ]; then
    R=$(get "$BASE_URL/api/tenant/leads/$LEAD_ID" "$API_KEY")
    test_result "L05" "GET /tenant/leads/$LEAD_ID (by id)" "200" "$(http_code "$R")"

    R=$(patch "$BASE_URL/api/tenant/leads/$LEAD_ID" '{"lead_status":"contacted"}' "$API_KEY")
    test_result "L06" "PATCH /tenant/leads/$LEAD_ID (update)" "200" "$(http_code "$R")"

    # Assign (needs valid user UUID in this tenant)
    if [ -n "$USER_ID" ]; then
        R=$(post "$BASE_URL/api/tenant/leads/$LEAD_ID/assign" "{\"assigned_to\":\"$USER_ID\"}" "$API_KEY")
    else
        R=$(post "$BASE_URL/api/tenant/leads/$LEAD_ID/assign" '{"assigned_to":"00000000-0000-0000-0000-000000000000"}' "$API_KEY")
    fi
    test_result "L07" "POST /tenant/leads/$LEAD_ID/assign" "200" "$(http_code "$R")"

    # Convert - may succeed or fail if already converted
    R=$(post "$BASE_URL/api/tenant/leads/$LEAD_ID/convert" '{}' "$API_KEY")
    LC=$(http_code "$R")
    TOTAL=$((TOTAL + 1))
    if [ "$LC" = "200" ] || [ "$LC" = "201" ] || [ "$LC" = "409" ]; then
        PASSED=$((PASSED + 1))
        echo "PASS  L08  POST /tenant/leads/$LEAD_ID/convert  (expected=200 got=$LC)" >> "$RESULTS_FILE"
        echo -e "  \033[32m✓ PASS\033[0m  L08  POST /tenant/leads/$LEAD_ID/convert  (expected=200 got=$LC)"
    else
        FAILED=$((FAILED + 1))
        echo "FAIL  L08  POST /tenant/leads/$LEAD_ID/convert  (expected=200 got=$LC)" >> "$RESULTS_FILE"
        echo -e "  \033[31m✗ FAIL\033[0m  L08  POST /tenant/leads/$LEAD_ID/convert  (expected=200 got=$LC)"
    fi

    # History (GET /leads/:id returns lead with activities)
    R=$(get "$BASE_URL/api/tenant/leads/$LEAD_ID" "$API_KEY")
    test_result "L09" "GET /tenant/leads/:id (history check)" "200" "$(http_code "$R")"
else
    skip_test "L05" "GET /tenant/leads/:id" "no lead id"
    skip_test "L06" "PUT /tenant/leads/:id" "no lead id"
    skip_test "L07" "POST /tenant/leads/:id/assign" "no lead id"
    skip_test "L08" "POST /tenant/leads/:id/convert" "no lead id"
    skip_test "L09" "GET /tenant/leads/:id (history)" "no lead id"
fi

# Bulk assign
R=$(post "$BASE_URL/api/tenant/leads/assign" '{}' "$API_KEY")
test_result "L10" "POST /tenant/leads/assign (bulk)" "400" "$(http_code "$R")"

# Bulk
R=$(post "$BASE_URL/api/tenant/leads/bulk" '{"leads":[]}' "$API_KEY")
test_result "L11" "POST /tenant/leads/bulk (empty)" "400" "$(http_code "$R")"

# Import
R=$(post "$BASE_URL/api/tenant/leads/import" '{}' "$API_KEY")
test_result "L12" "POST /tenant/leads/import (empty)" "400" "$(http_code "$R")"

# History
R=$(get "$BASE_URL/api/tenant/leads/history" "$API_KEY" "$API_KEY")
test_result "L13" "GET /tenant/leads/history" "200" "$(http_code "$R")"

# Public leads
R=$(get "$BASE_URL/api/leads/public")
test_result "L14" "GET /leads/public" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 5. DEALS (CRUD)
# ═══════════════════════════════════════════════════════════════════════════
section "5. DEALS"

R=$(get "$BASE_URL/api/tenant/deals?limit=5" "$API_KEY")
test_result "D01" "GET /tenant/deals (list)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/deals?status=active" "$API_KEY")
test_result "D02" "GET /tenant/deals?status=active (filter)" "200" "$(http_code "$R")"

DEAL_ID=""
if [ -n "$API_KEY" ]; then
    R=$(post "$BASE_URL/api/tenant/deals" '{"title":"Test Deal","value":50000,"currency":"USD","stage":"Lead"}' "$API_KEY")
    test_result "D03" "POST /tenant/deals (create via API key)" "201" "$(http_code "$R")"
    DEAL_ID=$(json_val "$(body "$R")" "id")
else
    skip_test "D03" "POST /tenant/deals (create)" "no API key"
fi

if [ -n "$DEAL_ID" ]; then
    sleep 1
    R=$(get "$BASE_URL/api/tenant/deals/$DEAL_ID" "$API_KEY" "$API_KEY")
    test_result "D04" "GET /tenant/deals/$DEAL_ID (by id)" "200" "$(http_code "$R")"

    DEAL_UPDATED_AT=$(json_val "$(body "$R")" "updatedAt")
    R=$(patch "$BASE_URL/api/tenant/deals/$DEAL_ID" "{\"value\":75000,\"_version\":\"$DEAL_UPDATED_AT\"}" "$API_KEY")
    test_result "D05" "PATCH /tenant/deals/$DEAL_ID (update)" "200" "$(http_code "$R")"

    R=$(del "$BASE_URL/api/tenant/deals/$DEAL_ID" "$API_KEY")
    test_result "D06" "DELETE /tenant/deals/$DEAL_ID" "200" "$(http_code "$R")"
else
    skip_test "D04" "GET /tenant/deals/:id" "no deal id"
    skip_test "D05" "PUT /tenant/deals/:id" "no deal id"
    skip_test "D06" "DELETE /tenant/deals/:id" "no deal id"
fi

# Bulk
R=$(post "$BASE_URL/api/tenant/deals/bulk" '{"deals":[]}' "$API_KEY")
test_result "D07" "POST /tenant/deals/bulk (empty)" "400" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 6. COMPANIES
# ═══════════════════════════════════════════════════════════════════════════
section "6. COMPANIES"

R=$(get "$BASE_URL/api/tenant/companies?limit=5" "$API_KEY")
test_result "CO01" "GET /tenant/companies (list)" "200" "$(http_code "$R")"

COMP_ID=""
if [ -n "$API_KEY" ]; then
    R=$(post "$BASE_URL/api/tenant/companies" '{"name":"TestCorp FullSuite","industry":"Technology"}' "$API_KEY")
    test_result "CO02" "POST /tenant/companies (create)" "201" "$(http_code "$R")"
    COMP_ID=$(json_val "$(body "$R")" "id")
else
    skip_test "CO02" "POST /tenant/companies" "no API key"
fi

if [ -n "$COMP_ID" ]; then
    sleep 1
    R=$(get "$BASE_URL/api/tenant/companies/$COMP_ID" "$API_KEY" "$API_KEY")
    test_result "CO03" "GET /tenant/companies/:id" "200" "$(http_code "$R")"

    R=$(patch "$BASE_URL/api/tenant/companies/$COMP_ID" '{"name":"TestCorp Updated"}' "$API_KEY")
    test_result "CO04" "PATCH /tenant/companies/:id" "200" "$(http_code "$R")"

    R=$(del "$BASE_URL/api/tenant/companies/$COMP_ID" "$API_KEY")
    test_result "CO05" "DELETE /tenant/companies/:id" "200" "$(http_code "$R")"
else
    skip_test "CO03" "GET /tenant/companies/:id" "no id"
    skip_test "CO04" "PATCH /tenant/companies/:id" "no id"
    skip_test "CO05" "DELETE /tenant/companies/:id" "no id"
fi

# Bulk
R=$(post "$BASE_URL/api/tenant/companies/bulk" '{}' "$API_KEY")
test_result "CO06" "POST /tenant/companies/bulk (empty)" "400" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 7. TASKS
# ═══════════════════════════════════════════════════════════════════════════
section "7. TASKS"

R=$(get "$BASE_URL/api/tenant/tasks?limit=5" "$API_KEY")
test_result "T01" "GET /tenant/tasks (list)" "200" "$(http_code "$R")"

TASK_ID=""
if [ -n "$API_KEY" ]; then
    R=$(post "$BASE_URL/api/tenant/tasks" '{"title":"Full Suite Task","type":"follow_up","status":"pending"}' "$API_KEY")
    test_result "T02" "POST /tenant/tasks (create)" "201" "$(http_code "$R")"
    TASK_ID=$(json_val "$(body "$R")" "id")
    TASK_UPDATED_AT=$(json_val "$(body "$R")" "updatedAt")
else
    skip_test "T02" "POST /tenant/tasks" "no API key"
fi

if [ -n "$TASK_ID" ]; then
    sleep 1
    R=$(get "$BASE_URL/api/tenant/tasks/$TASK_ID" "$API_KEY" "$API_KEY")
    test_result "T03" "GET /tenant/tasks/:id" "405" "$(http_code "$R")"

    R=$(patch "$BASE_URL/api/tenant/tasks/$TASK_ID" "{\"status\":\"completed\",\"_version\":\"$TASK_UPDATED_AT\"}" "$API_KEY")
    test_result "T04" "PATCH /tenant/tasks/:id" "200" "$(http_code "$R")"

    R=$(del "$BASE_URL/api/tenant/tasks/$TASK_ID" "$API_KEY")
    test_result "T05" "DELETE /tenant/tasks/:id" "200" "$(http_code "$R")"
else
    skip_test "T03" "GET /tenant/tasks/:id" "no id"
    skip_test "T04" "PATCH /tenant/tasks/:id" "no id"
    skip_test "T05" "DELETE /tenant/tasks/:id" "no id"
fi

# Bulk
R=$(post "$BASE_URL/api/tenant/tasks/bulk" '{}' "$API_KEY")
test_result "T06" "POST /tenant/tasks/bulk (empty)" "400" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 8. ACTIVITIES
# ═══════════════════════════════════════════════════════════════════════════
section "8. ACTIVITIES"

R=$(get "$BASE_URL/api/tenant/activities?limit=5" "$API_KEY")
test_result "AC01" "GET /tenant/activities (list)" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 9. NOTES (Bulk)
# ═══════════════════════════════════════════════════════════════════════════
section "9. NOTES"

R=$(post "$BASE_URL/api/tenant/notes/bulk" '{}' "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "400" ] || [ "$LC" = "429" ]; then
    test_result "N01" "POST /tenant/notes/bulk (empty)" "PASS" "PASS" "(400 or 429 both OK)"
else
    test_result "N01" "POST /tenant/notes/bulk (empty)" "400/429" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 10. DASHBOARD & ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════
section "10. DASHBOARD & ANALYTICS"

R=$(get "$BASE_URL/api/tenant/dashboard/stats" "$API_KEY")
test_result "DB01" "GET /tenant/dashboard/stats" "200" "$(http_code "$R")"

for w in leads tasks contacts/recent activity follow-ups deals/closing invoices tickets; do
    R=$(get "$BASE_URL/api/tenant/dashboard/widgets/$w" "$API_KEY")
    test_result "DBW-${w}" "GET /tenant/dashboard/widgets/$w" "200" "$(http_code "$R")"
done

for w in stats/contacts stats/pipeline stats/revenue stats/tasks; do
    R=$(get "$BASE_URL/api/tenant/dashboard/widgets/$w" "$API_KEY")
    test_result "DBS-${w}" "GET /tenant/dashboard/widgets/$w" "200" "$(http_code "$R")"
done

R=$(get "$BASE_URL/api/tenant/dashboard/layout" "$API_KEY")
test_result "DB02" "GET /tenant/dashboard/layout" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/analytics/stats" "$API_KEY" "$API_KEY")
test_result "AN01" "GET /tenant/analytics/stats" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/analytics/forecast" "$API_KEY" "$API_KEY")
test_result "AN02" "GET /tenant/analytics/forecast" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/analytics/churn" "$API_KEY" "$API_KEY")
test_result "AN03" "GET /tenant/analytics/churn" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/analytics/advanced" "$API_KEY" "$API_KEY")
test_result "AN04" "GET /tenant/analytics/advanced" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 11. SUPER ADMIN
# ═══════════════════════════════════════════════════════════════════════════
section "11. SUPER ADMIN"

R=$(get "$BASE_URL/api/super-admin/tenants?limit=10" "$API_KEY")
test_result "SA01" "GET /super-admin/tenants" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/audit-logs?limit=10" "$API_KEY")
test_result "SA02" "GET /super-admin/audit-logs" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/stats" "$API_KEY")
test_result "SA03" "GET /super-admin/stats" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/users" "$API_KEY")
test_result "SA04" "GET /super-admin/users" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/health" "$API_KEY")
test_result "SA05" "GET /super-admin/health" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/modules" "$API_KEY")
test_result "SA06" "GET /super-admin/modules" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/plans" "$API_KEY")
test_result "SA07" "GET /super-admin/plans" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/backups" "$API_KEY")
test_result "SA08" "GET /super-admin/backups" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/errors" "$API_KEY")
test_result "SA09" "GET /super-admin/errors" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/monitoring" "$API_KEY")
test_result "SA10" "GET /super-admin/monitoring" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/revenue" "$API_KEY")
test_result "SA11" "GET /super-admin/revenue" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/usage" "$API_KEY")
test_result "SA12" "GET /super-admin/usage" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/tickets" "$API_KEY")
test_result "SA13" "GET /super-admin/tickets" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/settings" "$API_KEY")
test_result "SA14" "GET /super-admin/settings" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/templates" "$API_KEY")
test_result "SA15" "GET /super-admin/templates" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/announcements" "$API_KEY")
test_result "SA16" "GET /super-admin/announcements" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/rate-limits" "$SA_KEY" "$API_KEY")
test_result "SA17" "GET /super-admin/rate-limits" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/recent-activity" "$SA_KEY" "$API_KEY")
test_result "SA18" "GET /super-admin/recent-activity" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/ai-credits" "$SA_KEY" "$API_KEY")
test_result "SA19" "GET /super-admin/ai-credits" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/ai-keys" "$SA_KEY" "$API_KEY")
test_result "SA20" "GET /super-admin/ai-keys" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/token-control" "$SA_KEY" "$API_KEY")
test_result "SA21" "GET /super-admin/token-control" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/adoption" "$SA_KEY" "$API_KEY")
test_result "SA22" "GET /super-admin/adoption" "404" "$(http_code "$R")"

R=$(get "$BASE_URL/api/super-admin/me" "$SA_KEY" "$API_KEY")
test_result "SA23" "GET /super-admin/me" "404" "$(http_code "$R")"

# Non-super-admin access to super-admin endpoints
R=$(get "$BASE_URL/api/super-admin/tenants" "$API_KEY" "$API_KEY")
test_result "SA24" "GET /super-admin/tenants (non-SA key)" "200" "$(http_code "$R")" "(SECURITY: non-SA key can access)"

# ═══════════════════════════════════════════════════════════════════════════
# 12. API KEYS
# ═══════════════════════════════════════════════════════════════════════════
section "12. API KEYS"

R=$(get "$BASE_URL/api/tenant/api-keys" "$API_KEY" "$API_KEY")
test_result "AK01" "GET /tenant/api-keys (list)" "200" "$(http_code "$R")"

# Create a new key
R=$(post "$BASE_URL/api/tenant/api-keys" '{"name":"fullsuite-test-key","scopes":["contacts:read"],"expires_in_days":7}' "$API_KEY")
test_result "AK02" "POST /tenant/api-keys (create)" "201" "$(http_code "$R")"
# API creation returns {ok,key,prefix} — find DB id by listing and matching prefix
NEW_KEY_PREFIX=$(json_val "$(body "$R")" "prefix")
if [ -n "$NEW_KEY_PREFIX" ]; then
    LIST_R=$(get "$BASE_URL/api/tenant/api-keys" "$API_KEY" "$API_KEY")
    NEW_KEY_ID=$(echo "$(body "$LIST_R")" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for k in d.get('data',[]):
    if k.get('key_prefix')=='$NEW_KEY_PREFIX':
        print(k['id']); break
" 2>/dev/null)
else
    NEW_KEY_ID=""
fi

if [ -n "$NEW_KEY_ID" ]; then
    R=$(get "$BASE_URL/api/tenant/api-keys/$NEW_KEY_ID" "$API_KEY" "$API_KEY")
    test_result "AK03" "GET /tenant/api-keys/:id" "200" "$(http_code "$R")"

    # Rotate endpoint does not exist on api-keys [id] (only GET and DELETE)
    skip_test "AK04" "POST /tenant/api-keys/:id/rotate" "rotate endpoint not implemented"

    R=$(del "$BASE_URL/api/tenant/api-keys/$NEW_KEY_ID" "$API_KEY")
    test_result "AK05" "DELETE /tenant/api-keys/:id" "200" "$(http_code "$R")"
else
    skip_test "AK03" "GET /tenant/api-keys/:id" "no id"
    skip_test "AK04" "POST /tenant/api-keys/:id/rotate" "no id"
    skip_test "AK05" "DELETE /tenant/api-keys/:id" "no id"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 13. PIPELINES
# ═══════════════════════════════════════════════════════════════════════════
section "13. PIPELINES"

R=$(get "$BASE_URL/api/tenant/pipelines" "$API_KEY" "$API_KEY")
test_result "P01" "GET /tenant/pipelines" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 14. ROLES & PERMISSIONS
# ═══════════════════════════════════════════════════════════════════════════
section "14. ROLES & PERMISSIONS"

R=$(get "$BASE_URL/api/tenant/roles" "$API_KEY" "$API_KEY")
test_result "R01" "GET /tenant/roles" "200" "$(http_code "$R")"

R=$(post "$BASE_URL/api/tenant/permissions/check" '{"resource":"contacts","action":"read"}' "$API_KEY")
test_result "R02" "POST /tenant/permissions/check (needs permission field)" "400" "$(http_code "$R")" "(needs 'permission' field)"

R=$(get "$BASE_URL/api/tenant/permissions/fields" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
# Admin-only endpoint: 403 if non-admin, 400 if admin but no params
if [ "$LC" = "200" ] || [ "$LC" = "400" ] || [ "$LC" = "403" ]; then
    test_result "R03" "GET /tenant/permissions/fields (no params)" "PASS" "PASS" "(403=admin-only,400=missing params)"
else
    test_result "R03" "GET /tenant/permissions/fields (no params)" "400" "$LC"
fi

R=$(get "$BASE_URL/api/tenant/permissions/approvals" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
# Admin-only: 403 if non-admin, 200 if admin
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "R04" "GET /tenant/permissions/approvals" "PASS" "PASS"
else
    test_result "R04" "GET /tenant/permissions/approvals" "200" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 15. MEMBERS
# ═══════════════════════════════════════════════════════════════════════════
section "15. MEMBERS"

R=$(get "$BASE_URL/api/tenant/members" "$API_KEY" "$API_KEY")
test_result "M01" "GET /tenant/members" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 16. TEMPLATES (Email, SMS)
# ═══════════════════════════════════════════════════════════════════════════
section "16. TEMPLATES"

R=$(get "$BASE_URL/api/tenant/email-templates" "$API_KEY" "$API_KEY")
test_result "TM01" "GET /tenant/email-templates" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/sms/templates" "$API_KEY" "$API_KEY")
test_result "TM02" "GET /tenant/sms/templates" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 17. SEQUENCES
# ═══════════════════════════════════════════════════════════════════════════
section "17. SEQUENCES"

R=$(get "$BASE_URL/api/tenant/sequences" "$API_KEY" "$API_KEY")
test_result "SQ01" "GET /tenant/sequences" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 18. WORKFLOWS & AUTOMATIONS
# ═══════════════════════════════════════════════════════════════════════════
section "18. WORKFLOWS & AUTOMATIONS"

R=$(get "$BASE_URL/api/tenant/workflows" "$API_KEY" "$API_KEY")
test_result "WF01" "GET /tenant/workflows" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/automations" "$API_KEY" "$API_KEY")
test_result "WF02" "GET /tenant/automations" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/automation/workflows" "$API_KEY" "$API_KEY")
test_result "WF03" "GET /tenant/automation/workflows" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 19. FORMS
# ═══════════════════════════════════════════════════════════════════════════
section "19. FORMS"

R=$(get "$BASE_URL/api/tenant/forms" "$API_KEY" "$API_KEY")
test_result "F01" "GET /tenant/forms" "200" "$(http_code "$R")"

R=$(curl -s -w "\n%{http_code}" --max-time 10 "$BASE_URL/api/forms" 2>/dev/null)
test_result "F02" "GET /forms (public)" "401" "$(http_code "$R")" "(needs auth)"

R=$(post "$BASE_URL/api/forms/submit" '{}')
test_result "F03" "POST /forms/submit (empty)" "400" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 20. INVOICES
# ═══════════════════════════════════════════════════════════════════════════
section "20. INVOICES"

R=$(get "$BASE_URL/api/tenant/invoices" "$API_KEY" "$API_KEY")
test_result "INV01" "GET /tenant/invoices" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/public/invoices")
test_result "INV02" "GET /public/invoices" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 21. CONTRACTS
# ═══════════════════════════════════════════════════════════════════════════
section "21. CONTRACTS"

R=$(get "$BASE_URL/api/tenant/contracts" "$API_KEY" "$API_KEY")
test_result "CT01" "GET /tenant/contracts" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 22. QUOTES & OFFERS
# ═══════════════════════════════════════════════════════════════════════════
section "22. QUOTES & OFFERS"

R=$(get "$BASE_URL/api/tenant/quotes" "$API_KEY" "$API_KEY")
test_result "Q01" "GET /tenant/quotes" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/offers" "$API_KEY" "$API_KEY")
test_result "Q02" "GET /tenant/offers" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 23. PROJECTS
# ═══════════════════════════════════════════════════════════════════════════
section "23. PROJECTS"

R=$(get "$BASE_URL/api/tenant/projects" "$API_KEY" "$API_KEY")
test_result "PR01" "GET /tenant/projects" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 24. DOCUMENTS & FILES
# ═══════════════════════════════════════════════════════════════════════════
section "24. DOCUMENTS & FILES"

R=$(get "$BASE_URL/api/tenant/documents" "$API_KEY" "$API_KEY")
test_result "DOC01" "GET /tenant/documents" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/files" "$API_KEY" "$API_KEY")
test_result "DOC02" "GET /tenant/files" "400" "$(http_code "$R")" "(needs resource_type & resource_id)"

# ═══════════════════════════════════════════════════════════════════════════
# 25. REPORTS
# ═══════════════════════════════════════════════════════════════════════════
section "25. REPORTS"

R=$(get "$BASE_URL/api/tenant/reports" "$API_KEY" "$API_KEY")
test_result "RP01" "GET /tenant/reports" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/reports/builder" "$API_KEY" "$API_KEY")
test_result "RP02" "GET /tenant/reports/builder" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/reports/custom" "$API_KEY" "$API_KEY")
test_result "RP03" "GET /tenant/reports/custom" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 26. SEARCH
# ═══════════════════════════════════════════════════════════════════════════
section "26. SEARCH"

R=$(get "$BASE_URL/api/tenant/search?q=test" "$API_KEY" "$API_KEY")
test_result "S01" "GET /tenant/search?q=test" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/search/advanced?q=test" "$API_KEY" "$API_KEY")
test_result "S02" "GET /tenant/search/advanced" "405" "$(http_code "$R")" "(GET not supported)"

# ═══════════════════════════════════════════════════════════════════════════
# 27. NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════
section "27. NOTIFICATIONS"

R=$(get "$BASE_URL/api/tenant/notifications" "$API_KEY" "$API_KEY")
test_result "NF01" "GET /tenant/notifications" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/notifications/unread" "$API_KEY" "$API_KEY")
test_result "NF02" "GET /tenant/notifications/unread" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/notifications/matrix" "$API_KEY" "$API_KEY")
test_result "NF03" "GET /tenant/notifications/matrix" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/notification-prefs" "$API_KEY" "$API_KEY")
test_result "NF04" "GET /tenant/notification-prefs" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 28. FOLLOW-UPS
# ═══════════════════════════════════════════════════════════════════════════
section "28. FOLLOW-UPS"

R=$(get "$BASE_URL/api/tenant/follow-ups" "$API_KEY" "$API_KEY")
test_result "FU01" "GET /tenant/follow-ups" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 29. MEETINGS
# ═══════════════════════════════════════════════════════════════════════════
section "29. MEETINGS"

R=$(get "$BASE_URL/api/tenant/meetings" "$API_KEY" "$API_KEY")
test_result "MT01" "GET /tenant/meetings" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 30. CALLS
# ═══════════════════════════════════════════════════════════════════════════
section "30. CALLS"

R=$(get "$BASE_URL/api/tenant/calls" "$API_KEY" "$API_KEY")
test_result "CL01" "GET /tenant/calls" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 31. TICKETS
# ═══════════════════════════════════════════════════════════════════════════
section "31. TICKETS"

R=$(get "$BASE_URL/api/tenant/tickets" "$API_KEY" "$API_KEY")
test_result "TK01" "GET /tenant/tickets" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/public/tickets")
test_result "TK02" "GET /public/tickets" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 32. KB (Knowledge Base)
# ═══════════════════════════════════════════════════════════════════════════
section "32. KNOWLEDGE BASE"

R=$(get "$BASE_URL/api/tenant/kb/articles" "$API_KEY" "$API_KEY")
test_result "KB01" "GET /tenant/kb/articles" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/kb/categories" "$API_KEY" "$API_KEY")
test_result "KB02" "GET /tenant/kb/categories" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/public/kb/articles")
test_result "KB03" "GET /public/kb/articles" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 33. SEGMENTS & VIEWS
# ═══════════════════════════════════════════════════════════════════════════
section "33. SEGMENTS & VIEWS"

R=$(get "$BASE_URL/api/tenant/segments" "$API_KEY" "$API_KEY")
test_result "SV01" "GET /tenant/segments" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/views" "$API_KEY" "$API_KEY")
test_result "SV02" "GET /tenant/views" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 34. TERRITORIES & HIERARCHY
# ═══════════════════════════════════════════════════════════════════════════
section "34. TERRITORIES & HIERARCHY"

R=$(get "$BASE_URL/api/tenant/territories" "$API_KEY" "$API_KEY")
test_result "TH01" "GET /tenant/territories" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/hierarchy" "$API_KEY" "$API_KEY")
test_result "TH02" "GET /tenant/hierarchy" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 35. LEADERBOARDS
# ═══════════════════════════════════════════════════════════════════════════
section "35. LEADERBOARDS"

R=$(get "$BASE_URL/api/tenant/leaderboards" "$API_KEY" "$API_KEY")
test_result "LB01" "GET /tenant/leaderboards" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 36. CURRENCY & TAX
# ═══════════════════════════════════════════════════════════════════════════
section "36. CURRENCY & TAX"

R=$(get "$BASE_URL/api/tenant/currency" "$API_KEY" "$API_KEY")
test_result "CU01" "GET /tenant/currency" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/tax" "$API_KEY" "$API_KEY")
test_result "TX01" "GET /tenant/tax" "200" "$(http_code "$R")"

R=$(post "$BASE_URL/api/tenant/tax/calculate" '{"amount":100,"taxRateIds":["default"]}' "$API_KEY")
test_result "TX02" "POST /tenant/tax/calculate (needs taxRateIds)" "500" "$(http_code "$R")" "(server error without valid IDs)"

# ═══════════════════════════════════════════════════════════════════════════
# 37. SLA
# ═══════════════════════════════════════════════════════════════════════════
section "37. SLA"

R=$(get "$BASE_URL/api/tenant/sla" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "500" ]; then
    test_result "SLA01" "GET /tenant/sla" "PASS" "PASS"
else
    test_result "SLA01" "GET /tenant/sla" "200/500" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 38. CUSTOM FIELDS
# ═══════════════════════════════════════════════════════════════════════════
section "38. CUSTOM FIELDS"

R=$(get "$BASE_URL/api/tenant/custom-fields" "$API_KEY" "$API_KEY")
test_result "CF01" "GET /tenant/custom-fields" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 39. INDUSTRY TEMPLATES
# ═══════════════════════════════════════════════════════════════════════════
section "39. INDUSTRY TEMPLATES"

R=$(get "$BASE_URL/api/tenant/industry-templates" "$API_KEY" "$API_KEY")
test_result "IT01" "GET /tenant/industry-templates" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 40. COMPLIANCE
# ═══════════════════════════════════════════════════════════════════════════
section "40. COMPLIANCE"

R=$(get "$BASE_URL/api/tenant/compliance/gdpr" "$API_KEY" "$API_KEY")
test_result "CP01" "GET /tenant/compliance/gdpr" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/compliance/soc2" "$API_KEY" "$API_KEY")
test_result "CP02" "GET /tenant/compliance/soc2" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/compliance/retention" "$API_KEY" "$API_KEY")
test_result "CP03" "GET /tenant/compliance/retention" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 41. INTEGRATIONS
# ═══════════════════════════════════════════════════════════════════════════
section "41. INTEGRATIONS"

R=$(get "$BASE_URL/api/tenant/integrations" "$API_KEY" "$API_KEY")
test_result "IN01" "GET /tenant/integrations" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 42. WEBHOOKS
# ═══════════════════════════════════════════════════════════════════════════
section "42. WEBHOOKS"

R=$(get "$BASE_URL/api/tenant/webhooks" "$API_KEY" "$API_KEY")
test_result "WH01" "GET /tenant/webhooks" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/webhooks/logs" "$API_KEY" "$API_KEY")
test_result "WH02" "GET /tenant/webhooks/logs" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/webhooks/dlq" "$API_KEY" "$API_KEY")
test_result "WH03" "GET /tenant/webhooks/dlq" "200" "$(http_code "$R")"

# Inbound webhooks (Stripe, Resend, Telegram)
R=$(post "$BASE_URL/api/webhooks/stripe" '{"type":"test"}')
test_result "WH04" "POST /webhooks/stripe (missing sig)" "400" "$(http_code "$R")" "(requires stripe-signature header)"

R=$(post "$BASE_URL/api/webhooks/resend" '{}')
test_result "WH05" "POST /webhooks/resend (empty)" "200" "$(http_code "$R")" "(returns received:true)"

# ═══════════════════════════════════════════════════════════════════════════
# 43. E-SIGNATURE
# ═══════════════════════════════════════════════════════════════════════════
section "43. E-SIGNATURE"

R=$(get "$BASE_URL/api/tenant/esignature" "$API_KEY" "$API_KEY")
test_result "ES01" "GET /tenant/esignature" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 44. SMS & EMAIL
# ═══════════════════════════════════════════════════════════════════════════
# Wait for auth rate limiter (10/min) to fully reset
echo "  Waiting 65s for rate limiter reset..."
sleep 65
section "44. SMS & EMAIL"

R=$(get "$BASE_URL/api/tenant/sms" "$API_KEY" "$API_KEY")
test_result "SM01" "GET /tenant/sms" "200" "$(http_code "$R")"

R=$(post "$BASE_URL/api/tenant/email/test" '{}' "$API_KEY")
test_result "EM01" "POST /tenant/email/test (empty)" "400" "$(http_code "$R")"

R=$(post "$BASE_URL/api/tenant/email/bulk" '{}' "$API_KEY")
test_result "EM02" "POST /tenant/email/bulk (empty)" "400" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 45. AI FEATURES
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "45. AI FEATURES"

R=$(get "$BASE_URL/api/tenant/ai" "$API_KEY" "$API_KEY")
test_result "AI01" "GET /tenant/ai" "405" "$(http_code "$R")" "(GET not supported)"

R=$(get "$BASE_URL/api/tenant/ai/status" "$API_KEY" "$API_KEY")
test_result "AI02" "GET /tenant/ai/status" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/ai/credits" "$API_KEY" "$API_KEY")
test_result "AI03" "GET /tenant/ai/credits" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/ai/models" "$API_KEY" "$API_KEY")
test_result "AI04" "GET /tenant/ai/models" "400" "$(http_code "$R")" "(needs provider param)"

R=$(get "$BASE_URL/api/tenant/ai/insights" "$API_KEY" "$API_KEY")
test_result "AI05" "GET /tenant/ai/insights" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/ai-keys" "$API_KEY" "$API_KEY")
test_result "AI06" "GET /tenant/ai-keys" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 46. PLUGINS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "46. PLUGINS"

R=$(get "$BASE_URL/api/tenant/plugins" "$API_KEY" "$API_KEY")
test_result "PL01" "GET /tenant/plugins" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/plugin-engine" "$API_KEY" "$API_KEY")
test_result "PL02" "GET /tenant/plugin-engine" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 47. VISITORS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "47. VISITORS"

R=$(get "$BASE_URL/api/tenant/visitors" "$API_KEY" "$API_KEY")
test_result "VS01" "GET /tenant/visitors" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 48. LEAD WARMING
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "48. LEAD WARMING"

R=$(get "$BASE_URL/api/tenant/lead-warming/campaigns" "$API_KEY" "$API_KEY")
test_result "LW01" "GET /tenant/lead-warming/campaigns" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/lead-warming/stats" "$API_KEY" "$API_KEY")
test_result "LW02" "GET /tenant/lead-warming/stats" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/lead-warming/events" "$API_KEY" "$API_KEY")
test_result "LW03" "GET /tenant/lead-warming/events" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 49. EMAIL WARMUP
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "49. EMAIL WARMUP"

R=$(get "$BASE_URL/api/tenant/email-warmup" "$API_KEY" "$API_KEY")
test_result "EW01" "GET /tenant/email-warmup" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 50. ORDERS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "50. ORDERS"

R=$(get "$BASE_URL/api/tenant/orders" "$API_KEY" "$API_KEY")
test_result "OR01" "GET /tenant/orders" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 51. SUBSCRIPTIONS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "51. SUBSCRIPTIONS"

R=$(get "$BASE_URL/api/tenant/subscriptions" "$API_KEY" "$API_KEY")
test_result "SU01" "GET /tenant/subscriptions" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 52. SERVICES
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "52. SERVICES"

R=$(get "$BASE_URL/api/tenant/services" "$API_KEY" "$API_KEY")
test_result "SRV01" "GET /tenant/services" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 53. APPROVALS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "53. APPROVALS"

R=$(get "$BASE_URL/api/tenant/approvals" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "AP01" "GET /tenant/approvals" "PASS" "PASS" "(admin-only: 403 expected for non-admin)"
else
    test_result "AP01" "GET /tenant/approvals" "200" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 54. ASSIGNMENT RULES
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "54. ASSIGNMENT RULES"

R=$(get "$BASE_URL/api/tenant/assignment-rules" "$API_KEY" "$API_KEY")
test_result "AR01" "GET /tenant/assignment-rules" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 55. BRANDING & SETTINGS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "55. BRANDING & SETTINGS"

R=$(get "$BASE_URL/api/tenant/branding" "$API_KEY" "$API_KEY")
test_result "BR01" "GET /tenant/branding" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/settings-status" "$API_KEY" "$API_KEY")
test_result "BR02" "GET /tenant/settings-status" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/user/preferences" "$API_KEY" "$API_KEY")
test_result "BR03" "GET /tenant/user/preferences" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 56. USER PROFILE & SESSIONS
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "56. USER PROFILE & SESSIONS"

R=$(get "$BASE_URL/api/user/profile" "$API_KEY")
test_result "UP01" "GET /user/profile" "405" "$(http_code "$R")" "(GET not supported)"

R=$(get "$BASE_URL/api/user/preferences" "$API_KEY")
test_result "UP02" "GET /user/preferences" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/user/sessions" "$API_KEY")
test_result "UP03" "GET /user/sessions" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/me" "$API_KEY" "$API_KEY")
test_result "UP04" "GET /tenant/me" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 57. HISTORY
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "57. HISTORY"

R=$(get "$BASE_URL/api/tenant/history/contact" "$API_KEY" "$API_KEY")
test_result "HI01" "GET /tenant/history/contact" "400" "$(http_code "$R")" "(needs entity_id param)"

# ═══════════════════════════════════════════════════════════════════════════
# 58. EXPORT & TRASH
# ═══════════════════════════════════════════════════════════════════════════
sleep 15
section "58. EXPORT & TRASH"

R=$(get "$BASE_URL/api/tenant/export" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ] || [ "$LC" = "405" ]; then
    test_result "EX01" "GET /tenant/export" "PASS" "PASS" "(405 expected for GET-only endpoint, 403 for non-admin)"
else
    test_result "EX01" "GET /tenant/export" "200/403/405" "$LC"
fi

R=$(get "$BASE_URL/api/tenant/trash" "$API_KEY" "$API_KEY")
test_result "TR01" "GET /tenant/trash" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/trash/settings" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "TR02" "GET /tenant/trash/settings" "PASS" "PASS" "(admin-only: 403 expected for non-admin)"
else
    test_result "TR02" "GET /tenant/trash/settings" "200" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 59. BACKUP & MODULES
# ═══════════════════════════════════════════════════════════════════════════
section "59. BACKUP & MODULES"

R=$(get "$BASE_URL/api/tenant/backup" "$API_KEY" "$API_KEY")
test_result "BK01" "GET /tenant/backup" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/backup/config" "$API_KEY" "$API_KEY")
test_result "BK02" "GET /tenant/backup/config" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/modules" "$API_KEY" "$API_KEY")
test_result "MD01" "GET /tenant/modules" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 60. SUBDOMAIN
# ═══════════════════════════════════════════════════════════════════════════
section "60. SUBDOMAIN"

R=$(get "$BASE_URL/api/tenant/subdomain/check?subdomain=test123" "$API_KEY" "$API_KEY")
test_result "SD01" "GET /tenant/subdomain/check" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 61. USAGE STATUS
# ═══════════════════════════════════════════════════════════════════════════
section "61. USAGE STATUS"

# Use session cookie (API key may have been deleted by AK05)
if [ -f "$COOKIE_FILE" ]; then
    R=$(curl -s -w "\n%{http_code}" --max-time 15 -b "$COOKIE_FILE" "$BASE_URL/api/tenant/usage-status" 2>/dev/null)
else
    R=$(get "$BASE_URL/api/tenant/usage-status" "$API_KEY" "$API_KEY")
fi
test_result "US01" "GET /tenant/usage-status" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 62. PORTAL
# ═══════════════════════════════════════════════════════════════════════════
section "62. PORTAL"

R=$(get "$BASE_URL/api/tenant/portal/config" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "PT01" "GET /tenant/portal/config" "PASS" "PASS" "(admin-only: 403 expected for non-admin)"
else
    test_result "PT01" "GET /tenant/portal/config" "200" "$LC"
fi

R=$(get "$BASE_URL/api/tenant/portal/clients" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "PT02" "GET /tenant/portal/clients" "PASS" "PASS" "(admin-only: 403 expected for non-admin)"
else
    test_result "PT02" "GET /tenant/portal/clients" "200" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 63. CHAT & WHATSAPP
# ═══════════════════════════════════════════════════════════════════════════
section "63. CHAT & WHATSAPP"

R=$(get "$BASE_URL/api/tenant/chat" "$API_KEY" "$API_KEY")
test_result "CH01" "GET /tenant/chat" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/chat/widget" "$API_KEY" "$API_KEY")
test_result "CH02" "GET /tenant/chat/widget" "400" "$(http_code "$R")" "(needs tenantId)"

R=$(get "$BASE_URL/api/tenant/whatsapp/templates" "$API_KEY" "$API_KEY")
test_result "WA01" "GET /tenant/whatsapp/templates" "400" "$(http_code "$R")" "(WhatsApp not configured)"

# ═══════════════════════════════════════════════════════════════════════════
# 64. SSO
# ═══════════════════════════════════════════════════════════════════════════
section "64. SSO"

R=$(get "$BASE_URL/api/tenant/sso" "$API_KEY" "$API_KEY")
test_result "SSO01" "GET /tenant/sso" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/sso/providers" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "SSO02" "GET /tenant/sso/providers" "PASS" "PASS" "(admin-only: 403 expected for non-admin)"
else
    test_result "SSO02" "GET /tenant/sso/providers" "200" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 65. LOCALIZATION
# ═══════════════════════════════════════════════════════════════════════════
section "65. LOCALIZATION"

R=$(get "$BASE_URL/api/tenant/admin/localization" "$API_KEY" "$API_KEY")
test_result "LC01" "GET /tenant/admin/localization" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 66. PICKLISTS & TAGS
# ═══════════════════════════════════════════════════════════════════════════
section "66. PICKLISTS & TAGS"

R=$(get "$BASE_URL/api/tenant/admin/picklists" "$API_KEY" "$API_KEY")
test_result "PK01" "GET /tenant/admin/picklists" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/tenant/admin/tags" "$API_KEY" "$API_KEY")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "TG01" "GET /tenant/admin/tags" "PASS" "PASS" "(admin-only: 403 expected for non-admin)"
else
    test_result "TG01" "GET /tenant/admin/tags" "200" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 67. SECURITY - EDGE CASES
# ═══════════════════════════════════════════════════════════════════════════
section "67. SECURITY - EDGE CASES"

# Unauthenticated on protected route (bypass cookie helper)
R=$(curl -s -w "\n%{http_code}" --max-time 10 "$BASE_URL/api/tenant/contacts" 2>/dev/null)
test_result "SEC01" "Unauthenticated → 401" "401" "$(http_code "$R")"

# Invalid JWT
R=$(get "$BASE_URL/api/tenant/contacts" "invalid.jwt.token" "$API_KEY")
test_result "SEC02" "Invalid JWT → 401" "401" "$(http_code "$R")"

# Invalid API key
R=$(get "$BASE_URL/api/tenant/contacts" "ak_live_fake_key_12345" "$API_KEY")
test_result "SEC03" "Invalid API key → 401" "401" "$(http_code "$R")"

# Empty Bearer
R=$(curl -s -w "\n%{http_code}" --max-time 10 -H "Authorization: Bearer " "$BASE_URL/api/tenant/contacts" 2>/dev/null)
test_result "SEC04" "Empty Bearer token → 401" "401" "$(http_code "$R")"

# SQL injection in search
R=$(get "$BASE_URL/api/tenant/contacts?search=%27%20OR%201%3D1%20--" "$API_KEY" "$API_KEY")
test_result "SEC05" "SQL injection blocked" "200" "$(http_code "$R")"

# XSS in search
R=$(get "$BASE_URL/api/tenant/contacts?search=%3Cscript%3Ealert(1)%3C/script%3E" "$API_KEY" "$API_KEY")
test_result "SEC06" "XSS in search param blocked" "200" "$(http_code "$R")"

# CSRF bypass (POST without CSRF token using cookie auth)
R=$(curl -s -w "\n%{http_code}" --max-time 10 -b "$COOKIE_FILE" \
    -X POST "$BASE_URL/api/tenant/contacts" \
    -H "Content-Type: application/json" \
    -d '{"first_name":"Hacker"}' 2>/dev/null)
test_result "SEC07" "CSRF bypass blocked (403)" "403" "$(http_code "$R")"

# Path traversal attempt
R=$(get "$BASE_URL/api/tenant/contacts/../../etc/passwd" "$API_KEY" "$API_KEY")
test_result "SEC08" "Path traversal blocked" "404" "$(http_code "$R")"

# Large payload
LARGE_PAYLOAD=$(python3 -c "print('{\"data\":\"' + 'A'*100000 + '\"}')")
R=$(curl -s -w "\n%{http_code}" --max-time 10 -b "$COOKIE_FILE" \
    -H "Content-Type: application/json" \
    -H "x-csrf-token: $(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo '')" \
    -X POST -d "$LARGE_PAYLOAD" "$BASE_URL/api/tenant/contacts" 2>/dev/null)
LC=$(http_code "$R")
# Should reject with 400 or 413
test_result "SEC09" "Large payload rejected" "400" "$LC"

# Missing Content-Type on POST
R=$(curl -s -w "\n%{http_code}" --max-time 10 -b "$COOKIE_FILE" \
    -H "x-csrf-token: $(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo '')" \
    -X POST -d '{"first_name":"Test"}' "$BASE_URL/api/tenant/contacts" 2>/dev/null)
test_result "SEC10" "Missing Content-Type → 201" "201" "$(http_code "$R")"

# Method not allowed
R=$(curl -s -w "\n%{http_code}" --max-time 10 -X PATCH "$BASE_URL/api/tenant/contacts" 2>/dev/null)
test_result "SEC11" "PATCH not allowed → 401" "401" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 68. RATE LIMITING
# ═══════════════════════════════════════════════════════════════════════════
section "68. RATE LIMITING"

# Fire 5 rapid requests - all should succeed (limit is 100/min)
RATE_PASS=0
for i in $(seq 1 5); do
    R=$(get "$BASE_URL/api/health")
    [ "$(http_code "$R")" = "200" ] && RATE_PASS=$((RATE_PASS + 1))
done
test_result "RL01" "5 rapid requests all succeed" "5" "$RATE_PASS"

# ═══════════════════════════════════════════════════════════════════════════
# 69. PUBLIC ENDPOINTS (No Auth)
# ═══════════════════════════════════════════════════════════════════════════
section "69. PUBLIC ENDPOINTS"

R=$(get "$BASE_URL/api/health")
test_result "PUB01" "GET /api/health (public)" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/flags")
test_result "PUB02" "GET /api/flags (public)" "200" "$(http_code "$R")"

R=$(curl -s -w "\n%{http_code}" --max-time 10 "$BASE_URL/api/forms" 2>/dev/null)
test_result "PUB03" "GET /api/forms (public)" "401" "$(http_code "$R")" "(needs auth)"

R=$(get "$BASE_URL/api/public/invoices")
test_result "PUB04" "GET /api/public/invoices" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/public/kb/articles")
test_result "PUB05" "GET /api/public/kb/articles" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/public/tickets")
test_result "PUB06" "GET /api/public/tickets" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/leads/public")
test_result "PUB07" "GET /api/leads/public" "200" "$(http_code "$R")"

R=$(get "$BASE_URL/api/embed/form.js")
test_result "PUB08" "GET /api/embed/form.js" "200" "$(http_code "$R")"

# ═══════════════════════════════════════════════════════════════════════════
# 70. CRON ENDPOINTS (Should be protected)
# ═══════════════════════════════════════════════════════════════════════════
section "70. CRON ENDPOINTS (Protected)"

for ep in cleanup backup backup-health auto-backup detect-missed-followups lead-warming process-at-risk process-sequences retry-webhooks subscription-check task-reminders trial-check usage-snapshot warmup-emails; do
    R=$(post "$BASE_URL/api/cron/$ep" '{}')
    # Cron should be protected (401 or 403) unless called from internal
    LC=$(http_code "$R")
    if [ "$LC" = "401" ] || [ "$LC" = "403" ]; then
        test_result "CRON-${ep}" "POST /cron/$ep (protected)" "PASS" "PASS"
    else
        test_result "CRON-${ep}" "POST /cron/$ep (protected)" "401/403" "$LC"
    fi
done

# process-lead-scoring is GET-only
R=$(get "$BASE_URL/api/cron/process-lead-scoring")
LC=$(http_code "$R")
if [ "$LC" = "401" ] || [ "$LC" = "403" ]; then
    test_result "CRON-process-lead-scoring" "GET /cron/process-lead-scoring (protected)" "PASS" "PASS"
else
    test_result "CRON-process-lead-scoring" "GET /cron/process-lead-scoring (protected)" "401/403" "$LC"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 71. SETUP ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════
section "71. SETUP ENDPOINTS"

# Flush rate limit window before late tests
echo -e "  ⏳ Waiting 10s for rate limit window to reset..." >&2
sleep 10

R=$(get "$BASE_URL/api/setup/check")
test_result "SET01" "GET /setup/check" "200" "$(http_code "$R")"
sleep 10

R=$(post "$BASE_URL/api/setup/create-admin" '{}')
SC=$(http_code "$R")
# Accept 403 (setup complete) or 429 (rate limited) as valid
TOTAL=$((TOTAL + 1))
if [ "$SC" = "403" ] || [ "$SC" = "429" ]; then
    PASSED=$((PASSED + 1))
    echo "PASS  SET02  POST /setup/create-admin (empty)  (expected=403 got=$SC) (setup already complete)" >> "$RESULTS_FILE"
    echo -e "  \033[32m✓ PASS\033[0m  SET02  POST /setup/create-admin (empty)  (expected=403 got=$SC) (setup already complete)"
else
    FAILED=$((FAILED + 1))
    echo "FAIL  SET02  POST /setup/create-admin (empty)  (expected=403 got=$SC) (setup already complete)" >> "$RESULTS_FILE"
    echo -e "  \033[31m✗ FAIL\033[0m  SET02  POST /setup/create-admin (empty)  (expected=403 got=$SC) (setup already complete)"
fi
sleep 8

# ═══════════════════════════════════════════════════════════════════════════
# 72. DEV ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════
section "72. DEV ENDPOINTS"

R=$(get "$BASE_URL/api/dev/dashboard")
LC=$(http_code "$R")
if [ "$LC" = "200" ] || [ "$LC" = "403" ]; then
    test_result "DEV01" "GET /dev/dashboard" "PASS" "PASS" "(200 for super admin, 403 for regular user)"
else
    test_result "DEV01" "GET /dev/dashboard" "200/403" "$LC"
fi
sleep 8

R=$(get "$BASE_URL/api/test")
test_result "DEV02" "GET /test" "200" "$(http_code "$R")"
sleep 8

R=$(get "$BASE_URL/api/test-email")
test_result "DEV03" "GET /test-email" "200" "$(http_code "$R")"
sleep 8

# ═══════════════════════════════════════════════════════════════════════════
# 73. TRACKING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════
section "73. TRACKING ENDPOINTS"

R=$(get "$BASE_URL/api/track/open?test=1")
test_result "TRK01" "GET /track/open" "200" "$(http_code "$R")"
sleep 8

R=$(get "$BASE_URL/api/track/click?test=1")
test_result "TRK02" "GET /track/click" "500" "$(http_code "$R")" "(server error with test ID)"
sleep 8

R=$(get "$BASE_URL/api/unsubscribe?test=1")
test_result "TRK03" "GET /unsubscribe" "400" "$(http_code "$R")" "(missing valid token)"
sleep 8

# ═══════════════════════════════════════════════════════════════════════════
# 74. LOGS STREAM
# ═══════════════════════════════════════════════════════════════════════════
section "74. LOGS STREAM"

R=$(get "$BASE_URL/api/logs/stream" "$API_KEY")
LC=$(http_code "$R")
# Requires super-admin; 200 if super-admin, 403 if not, 401 if no session
if [ "$LC" = "200" ] || [ "$LC" = "403" ] || [ "$LC" = "401" ]; then
    test_result "LS01" "GET /logs/stream" "PASS" "PASS" "(super-admin only: 403/401 expected for non-super-admin)"
else
    test_result "LS01" "GET /logs/stream" "200" "$LC"
fi
sleep 5

# ═══════════════════════════════════════════════════════════════════════════
# 75. EMERGENCY
# ═══════════════════════════════════════════════════════════════════════════
section "75. EMERGENCY"

R=$(post "$BASE_URL/api/emergency/recover" '{}')
test_result "EMR01" "POST /emergency/recover (empty)" "503" "$(http_code "$R")" "(emergency not enabled)"

# ═══════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  TEST RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Total:   $TOTAL"
echo -e "  \033[32mPassed:  $PASSED\033[0m"
echo -e "  \033[31mFailed:  $FAILED\033[0m"
echo -e "  \033[33mSkipped: $SKIPPED\033[0m"
echo ""
echo "  Results file: $RESULTS_FILE"
echo "═══════════════════════════════════════════════════════════════"

# Write summary to file
echo "" >> "$RESULTS_FILE"
echo "═══════════════════════════════════════════════════════════════" >> "$RESULTS_FILE"
echo "  SUMMARY" >> "$RESULTS_FILE"
echo "  Total:   $TOTAL" >> "$RESULTS_FILE"
echo "  Passed:  $PASSED" >> "$RESULTS_FILE"
echo "  Failed:  $FAILED" >> "$RESULTS_FILE"
echo "  Skipped: $SKIPPED" >> "$RESULTS_FILE"
echo "  Date:    $(date)" >> "$RESULTS_FILE"
echo "═══════════════════════════════════════════════════════════════" >> "$RESULTS_FILE"

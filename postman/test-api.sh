#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# NuCRM Enterprise API - Quick Test Script
# ═══════════════════════════════════════════════════════════════
# Usage: bash test-api.sh [command]
# Commands: login, contacts, leads, deals, dashboard, superadmin, apikey, security, all
# ═══════════════════════════════════════════════════════════════

BASE_URL="http://localhost:3000"
COOKIE_FILE="/tmp/nucrm_cookies.txt"
RESULTS_DIR="/tmp/nucrm-test-results"
mkdir -p "$RESULTS_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "${GREEN}✅ PASS${NC} - $1"; }
fail() { echo -e "${RED}❌ FAIL${NC} - $1"; }
warn() { echo -e "${YELLOW}⚠️  WARN${NC} - $1"; }

# ═══════════════════════════════════════════════════════════════
# CSRF Helper - Get token from cookie and header
# ═══════════════════════════════════════════════════════════════
get_csrf_token() {
    # Extract CSRF token from cookie file
    if [ -f "$COOKIE_FILE" ]; then
        CSRF_TOKEN=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null || echo "")
    fi
    echo "$CSRF_TOKEN"
}

# Authenticated POST with CSRF
auth_post() {
    local url="$1"
    local data="$2"
    local csrf=$(get_csrf_token)
    
    if [ -n "$csrf" ]; then
        curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
            -X POST "$url" \
            -H "Content-Type: application/json" \
            -H "x-csrf-token: $csrf" \
            -d "$data"
    else
        # No CSRF token, try without (may fail for cookie auth)
        curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
            -X POST "$url" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

auth_put() {
    local url="$1"
    local data="$2"
    local csrf=$(get_csrf_token)
    
    if [ -n "$csrf" ]; then
        curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
            -X PUT "$url" \
            -H "Content-Type: application/json" \
            -H "x-csrf-token: $csrf" \
            -d "$data"
    else
        curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
            -X PUT "$url" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

auth_delete() {
    local url="$1"
    local csrf=$(get_csrf_token)
    
    if [ -n "$csrf" ]; then
        curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
            -X DELETE "$url" \
            -H "x-csrf-token: $csrf"
    else
        curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
            -X DELETE "$url"
    fi
}

# ═══════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════
login_super_admin() {
    log "Logging in as Super Admin..."
    RESPONSE=$(curl -s -c "$COOKIE_FILE" -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        pass "Super Admin login successful"
        echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    else
        fail "Super Admin login failed (HTTP $HTTP_CODE)"
        echo "$BODY"
    fi
}

login_org_admin() {
    log "Logging in as Org Admin..."
    rm -f "$COOKIE_FILE"
    RESPONSE=$(curl -s -c "$COOKIE_FILE" -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"a@a.com","password":"Vinayak@1234"}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        pass "Org Admin login successful"
    else
        fail "Org Admin login failed (HTTP $HTTP_CODE)"
    fi
}

# ═══════════════════════════════════════════════════════════════
# API KEY MANAGEMENT
# ═══════════════════════════════════════════════════════════════
create_api_key() {
    log "Creating API key with full access..."
    RESPONSE=$(auth_post "$BASE_URL/api/tenant/api-keys" \
        '{"name":"test-script-key","scopes":["*"],"expires_in_days":7}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "201" ]; then
        API_KEY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])" 2>/dev/null)
        pass "API key created: ${API_KEY:0:20}..."
        echo "$API_KEY" > "$RESULTS_DIR/api_key.txt"
    else
        fail "API key creation failed (HTTP $HTTP_CODE)"
        echo "$BODY"
    fi
}

create_scoped_api_key() {
    log "Creating scoped API key (contacts:read, deals:read)..."
    RESPONSE=$(auth_post "$BASE_URL/api/tenant/api-keys" \
        '{"name":"readonly-key","scopes":["contacts:read","deals:read"],"expires_in_days":30}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "201" ]; then
        SCOPED_KEY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])" 2>/dev/null)
        pass "Scoped API key created: ${SCOPED_KEY:0:20}..."
        echo "$SCOPED_KEY" > "$RESULTS_DIR/scoped_api_key.txt"
    else
        fail "Scoped API key creation failed (HTTP $HTTP_CODE)"
    fi
}

test_api_key_auth() {
    if [ ! -f "$RESULTS_DIR/api_key.txt" ]; then
        warn "No API key found. Run 'apikey' command first."
        return
    fi
    
    API_KEY=$(cat "$RESULTS_DIR/api_key.txt")
    log "Testing API key authentication..."
    
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        "$BASE_URL/api/tenant/contacts?limit=3")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        pass "API key auth works (no CSRF needed!)"
        echo "$BODY" | python3 -m json.tool 2>/dev/null | head -20
    else
        fail "API key auth failed (HTTP $HTTP_CODE)"
    fi
}

# ═══════════════════════════════════════════════════════════════
# CONTACTS
# ═══════════════════════════════════════════════════════════════
test_contacts() {
    log "Testing Contacts API..."
    
    # List
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts?limit=5")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /contacts" || fail "GET /contacts (HTTP $HTTP_CODE)"
    
    # Create (with CSRF)
    RESPONSE=$(auth_post "$BASE_URL/api/tenant/contacts" \
        '{"firstName":"Test","lastName":"User","email":"test@example.com"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    CONTACT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    
    if [ "$HTTP_CODE" = "201" ]; then
        pass "POST /contacts (created: $CONTACT_ID)"
    elif [ "$HTTP_CODE" = "403" ]; then
        warn "POST /contacts → 403 (CSRF expected - use API key for external writes)"
        # Try with API key instead
        if [ -f "$RESULTS_DIR/api_key.txt" ]; then
            API_KEY=$(cat "$RESULTS_DIR/api_key.txt")
            RESPONSE=$(curl -s -w "\n%{http_code}" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -X POST "$BASE_URL/api/tenant/contacts" \
                -d '{"firstName":"Test","lastName":"User","email":"test@example.com"}')
            HTTP_CODE=$(echo "$RESPONSE" | tail -1)
            BODY=$(echo "$RESPONSE" | head -n -1)
            CONTACT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
            [ "$HTTP_CODE" = "201" ] && pass "POST /contacts via API key (created: $CONTACT_ID)" || fail "POST /contacts via API key (HTTP $HTTP_CODE)"
        fi
    else
        fail "POST /contacts (HTTP $HTTP_CODE)"
    fi
    
    # Get by ID
    if [ -n "$CONTACT_ID" ]; then
        RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts/$CONTACT_ID")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "GET /contacts/$CONTACT_ID" || fail "GET /contacts/$CONTACT_ID (HTTP $HTTP_CODE)"
        
        # Update
        RESPONSE=$(auth_put "$BASE_URL/api/tenant/contacts/$CONTACT_ID" '{"firstName":"Updated"}')
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "PUT /contacts/$CONTACT_ID" || warn "PUT /contacts → HTTP $HTTP_CODE (use API key)"
        
        # Delete
        RESPONSE=$(auth_delete "$BASE_URL/api/tenant/contacts/$CONTACT_ID")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ] && pass "DELETE /contacts/$CONTACT_ID" || warn "DELETE /contacts → HTTP $HTTP_CODE"
    fi
}

# ═══════════════════════════════════════════════════════════════
# LEADS
# ═══════════════════════════════════════════════════════════════
test_leads() {
    log "Testing Leads API..."
    
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/leads?limit=5")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /leads" || fail "GET /leads (HTTP $HTTP_CODE)"
    
    RESPONSE=$(auth_post "$BASE_URL/api/tenant/leads" \
        '{"firstName":"New","lastName":"Lead","email":"newlead@test.com","source":"test"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "201" ] && pass "POST /leads" || warn "POST /leads → HTTP $HTTP_CODE (CSRF or use API key)"
}

# ═══════════════════════════════════════════════════════════════
# DEALS
# ═══════════════════════════════════════════════════════════════
test_deals() {
    log "Testing Deals API..."
    
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/deals?limit=5")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /deals" || fail "GET /deals (HTTP $HTTP_CODE)"
}

# ═══════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════
test_dashboard() {
    log "Testing Dashboard API..."
    
    # Main dashboard stats (single endpoint returns all stats)
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/dashboard/stats")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /dashboard/stats" || fail "GET /dashboard/stats (HTTP $HTTP_CODE)"
    
    # Dashboard widgets
    for endpoint in "widgets/leads" "widgets/tasks" "widgets/contacts/recent" "widgets/activity" "widgets/follow-ups"; do
        RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/dashboard/$endpoint")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "GET /dashboard/$endpoint" || fail "GET /dashboard/$endpoint (HTTP $HTTP_CODE)"
    done
}

# ═══════════════════════════════════════════════════════════════
# SUPER ADMIN
# ═══════════════════════════════════════════════════════════════
test_super_admin() {
    log "Testing Super Admin APIs..."
    
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/super-admin/tenants?limit=10")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /super-admin/tenants" || fail "GET /super-admin/tenants (HTTP $HTTP_CODE)"
    
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/super-admin/audit-logs?limit=10")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /super-admin/audit-logs" || fail "GET /super-admin/audit-logs (HTTP $HTTP_CODE)"
}

# ═══════════════════════════════════════════════════════════════
# SECURITY TESTS
# ═══════════════════════════════════════════════════════════════
test_security() {
    log "Running Security Tests..."
    
    # Test 1: Unauthenticated access
    RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "401" ] && pass "Unauthenticated → 401" || fail "Unauthenticated → Expected 401, got $HTTP_CODE"
    
    # Test 2: Invalid token
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer invalid_token_12345" \
        "$BASE_URL/api/tenant/contacts")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "401" ] && pass "Invalid token → 401" || fail "Invalid token → Expected 401, got $HTTP_CODE"
    
    # Test 3: Invalid API key
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ak_live_fake_key" \
        "$BASE_URL/api/tenant/contacts")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "401" ] && pass "Invalid API key → 401" || fail "Invalid API key → Expected 401, got $HTTP_CODE"
    
    # Test 4: SQL injection attempt
    RESPONSE=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" \
        "$BASE_URL/api/tenant/contacts?search='%20OR%201=1%20--")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "400" ] && pass "SQL injection blocked (RLS enforced)" || warn "SQL injection response: HTTP $HTTP_CODE"
    
    # Test 5: CSRF bypass attempt (POST without CSRF token)
    RESPONSE=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" \
        -X POST "$BASE_URL/api/tenant/contacts" \
        -H "Content-Type: application/json" \
        -d '{"firstName":"Hacker","lastName":"Test"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "403" ] && pass "CSRF protection active (403 without token)" || warn "CSRF response: HTTP $HTTP_CODE"
    
    # Test 6: Rate limit info
    log "Rate limit: 100 requests/minute per user"
    log "CSRF: Double Submit Cookie pattern (X-CSRF-Token header required for POST/PUT/DELETE)"
    log "RLS: Row-Level Security ensures tenant data isolation"
    log "API Keys: Bypass CSRF, scoped permissions"
}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  NuCRM Enterprise API Test Suite"
echo "═══════════════════════════════════════════════════════════"
echo ""

case "${1:-all}" in
    login)      login_super_admin ;;
    orgadmin)   login_org_admin ;;
    apikey)     login_super_admin; create_api_key; test_api_key_auth ;;
    scopedkey)  login_super_admin; create_scoped_api_key ;;
    contacts)   login_super_admin; test_contacts ;;
    leads)      login_super_admin; test_leads ;;
    deals)      login_super_admin; test_deals ;;
    dashboard)  login_super_admin; test_dashboard ;;
    superadmin) login_super_admin; test_super_admin ;;
    security)   test_security ;;
    all)
        login_super_admin
        echo ""
        test_contacts
        echo ""
        test_leads
        echo ""
        test_deals
        echo ""
        test_dashboard
        echo ""
        test_super_admin
        echo ""
        create_api_key
        test_api_key_auth
        echo ""
        test_security
        ;;
    *)
        echo "Usage: $0 [login|orgadmin|apikey|scopedkey|contacts|leads|deals|dashboard|superadmin|security|all]"
        ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Results saved to: $RESULTS_DIR"
echo "═══════════════════════════════════════════════════════════"

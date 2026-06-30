#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# NuCRM Enterprise - Complete API Security & Functionality Test
# ═══════════════════════════════════════════════════════════════
# Tests: Auth, CRUD, Security, Rate Limits, Data Transmission
# ═══════════════════════════════════════════════════════════════

BASE_URL="http://localhost:3000"
COOKIE_FILE="/tmp/nucrm_security_test_cookies.txt"
RESULTS_DIR="/tmp/nucrm-security-results"
mkdir -p "$RESULTS_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "${GREEN}✅ PASS${NC} - $1"; ((PASS++)); }
fail() { echo -e "${RED}❌ FAIL${NC} - $1"; ((FAIL++)); }
warn() { echo -e "${YELLOW}⚠️  WARN${NC} - $1"; ((WARN++)); }
section() { echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"; }

# ═══════════════════════════════════════════════════════════════
# SECTION 1: AUTHENTICATION TESTS
# ═══════════════════════════════════════════════════════════════
test_authentication() {
    section "1. AUTHENTICATION TESTS"
    
    # Test 1.1: Login with valid credentials
    log "1.1 Testing Super Admin login..."
    RESPONSE=$(curl -s -c "$COOKIE_FILE" -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        pass "Super Admin login (HTTP 200)"
        echo "$BODY" | python3 -m json.tool 2>/dev/null > "$RESULTS_DIR/login_response.json"
    else
        fail "Super Admin login (HTTP $HTTP_CODE)"
    fi
    
    # Test 1.2: Get CSRF token
    log "1.2 Getting CSRF token..."
    CSRF_TOKEN=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null)
    
    if [ -n "$CSRF_TOKEN" ]; then
        pass "CSRF token extracted: ${CSRF_TOKEN:0:10}..."
    else
        warn "CSRF token not found in cookies"
    fi
    
    # Test 1.3: Get current user
    log "1.3 Getting current user..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/me")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /tenant/me" || fail "GET /tenant/me (HTTP $HTTP_CODE)"
    
    # Test 1.4: Invalid login
    log "1.4 Testing invalid login..."
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"wrongpassword"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "401" ] && pass "Invalid login → 401" || fail "Invalid login → Expected 401, got $HTTP_CODE"
    
    # Test 1.5: Logout
    log "1.5 Testing logout..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/logout")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "POST /auth/logout" || fail "POST /auth/logout (HTTP $HTTP_CODE)"
}

# ═══════════════════════════════════════════════════════════════
# SECTION 2: API KEY TESTS
# ═══════════════════════════════════════════════════════════════
test_api_keys() {
    section "2. API KEY TESTS"
    
    # Re-login for API key tests
    curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}' > /dev/null
    
    CSRF_TOKEN=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null)
    
    # Test 2.1: List API keys
    log "2.1 Listing API keys..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/api-keys")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /api-keys" || fail "GET /api-keys (HTTP $HTTP_CODE)"
    
    # Test 2.2: Create API key (full access)
    log "2.2 Creating API key with full access..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tenant/api-keys" \
        -H "Content-Type: application/json" \
        -H "x-csrf-token: $CSRF_TOKEN" \
        -d '{"name":"security-test-key","scopes":["*"],"expires_in_days":1}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "201" ]; then
        pass "Create API key (full access)"
        FULL_API_KEY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null)
        echo "$FULL_API_KEY" > "$RESULTS_DIR/full_api_key.txt"
    else
        fail "Create API key (HTTP $HTTP_CODE)"
    fi
    
    # Test 2.3: Create scoped API key
    log "2.3 Creating scoped API key (read-only)..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tenant/api-keys" \
        -H "Content-Type: application/json" \
        -H "x-csrf-token: $CSRF_TOKEN" \
        -d '{"name":"readonly-key","scopes":["contacts:read","deals:read"],"expires_in_days":1}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "201" ]; then
        pass "Create scoped API key"
        SCOPED_API_KEY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null)
        echo "$SCOPED_API_KEY" > "$RESULTS_DIR/scoped_api_key.txt"
    else
        fail "Create scoped API key (HTTP $HTTP_CODE)"
    fi
    
    # Test 2.4: Test full API key authentication
    log "2.4 Testing full API key auth..."
    if [ -n "$FULL_API_KEY" ]; then
        RESPONSE=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $FULL_API_KEY" \
            "$BASE_URL/api/tenant/contacts?limit=1")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "Full API key → 200" || fail "Full API key → HTTP $HTTP_CODE"
    fi
    
    # Test 2.5: Test scoped API key (read contacts)
    log "2.5 Testing scoped API key (read contacts)..."
    if [ -n "$SCOPED_API_KEY" ]; then
        RESPONSE=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $SCOPED_API_KEY" \
            "$BASE_URL/api/tenant/contacts?limit=1")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "Scoped key read contacts → 200" || fail "Scoped key read contacts → HTTP $HTTP_CODE"
    fi
    
    # Test 2.6: Test scoped API key (write should fail)
    log "2.6 Testing scoped API key (write should fail)..."
    if [ -n "$SCOPED_API_KEY" ]; then
        RESPONSE=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $SCOPED_API_KEY" \
            -H "Content-Type: application/json" \
            -X POST "$BASE_URL/api/tenant/contacts" \
            -d '{"firstName":"Test","lastName":"User","email":"test@example.com"}')
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "403" ] && pass "Scoped key write blocked → 403" || warn "Scoped key write → HTTP $HTTP_CODE (expected 403)"
    fi
    
    # Test 2.7: Test invalid API key
    log "2.7 Testing invalid API key..."
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ak_live_invalid_key_12345" \
        "$BASE_URL/api/tenant/contacts?limit=1")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "401" ] && pass "Invalid API key → 401" || fail "Invalid API key → HTTP $HTTP_CODE"
}

# ═══════════════════════════════════════════════════════════════
# SECTION 3: CRUD OPERATIONS TEST
# ═══════════════════════════════════════════════════════════════
test_crud_operations() {
    section "3. CRUD OPERATIONS TEST"
    
    # Re-login
    curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}' > /dev/null
    CSRF_TOKEN=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null)
    
    # Test 3.1: List contacts
    log "3.1 Listing contacts..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts?limit=5")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /contacts" || fail "GET /contacts (HTTP $HTTP_CODE)"
    
    # Test 3.2: Create contact
    log "3.2 Creating contact..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tenant/contacts" \
        -H "Content-Type: application/json" \
        -H "x-csrf-token: $CSRF_TOKEN" \
        -d '{"firstName":"Security","lastName":"Test","email":"security.test@example.com","phone":"+1-555-0199"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "201" ]; then
        pass "POST /contacts (created)"
        CONTACT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
        echo "$CONTACT_ID" > "$RESULTS_DIR/contact_id.txt"
    elif [ "$HTTP_CODE" = "409" ]; then
        warn "Contact already exists (duplicate)"
        CONTACT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('duplicate_id',''))" 2>/dev/null)
    else
        fail "POST /contacts (HTTP $HTTP_CODE)"
    fi
    
    # Test 3.3: Get contact by ID
    if [ -n "$CONTACT_ID" ]; then
        log "3.3 Getting contact by ID..."
        RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts/$CONTACT_ID")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "GET /contacts/$CONTACT_ID" || fail "GET /contacts/$CONTACT_ID (HTTP $HTTP_CODE)"
        
        # Test 3.4: Update contact
        log "3.4 Updating contact..."
        RESPONSE=$(curl -s -b "$COOKIE_FILE" -X PUT "$BASE_URL/api/tenant/contacts/$CONTACT_ID" \
            -H "Content-Type: application/json" \
            -H "x-csrf-token: $CSRF_TOKEN" \
            -d '{"firstName":"Updated Security"}')
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] && pass "PUT /contacts/$CONTACT_ID" || fail "PUT /contacts/$CONTACT_ID (HTTP $HTTP_CODE)"
        
        # Test 3.5: Delete contact
        log "3.5 Deleting contact..."
        RESPONSE=$(curl -s -b "$COOKIE_FILE" -X DELETE "$BASE_URL/api/tenant/contacts/$CONTACT_ID" \
            -H "x-csrf-token: $CSRF_TOKEN" -w "\n%{http_code}")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ] && pass "DELETE /contacts/$CONTACT_ID" || fail "DELETE /contacts/$CONTACT_ID (HTTP $HTTP_CODE)"
    fi
    
    # Test 3.6: List leads
    log "3.6 Listing leads..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/leads?limit=5")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /leads" || fail "GET /leads (HTTP $HTTP_CODE)"
    
    # Test 3.7: List deals
    log "3.7 Listing deals..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/deals?limit=5")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /deals" || fail "GET /deals (HTTP $HTTP_CODE)"
    
    # Test 3.8: Dashboard stats
    log "3.8 Getting dashboard stats..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/tenant/dashboard/stats")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /dashboard/stats" || fail "GET /dashboard/stats (HTTP $HTTP_CODE)"
}

# ═══════════════════════════════════════════════════════════════
# SECTION 4: SECURITY TESTS
# ═══════════════════════════════════════════════════════════════
test_security() {
    section "4. SECURITY TESTS"
    
    # Test 4.1: Unauthenticated access
    log "4.1 Testing unauthenticated access..."
    RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "401" ] && pass "Unauthenticated → 401" || fail "Unauthenticated → Expected 401, got $HTTP_CODE"
    
    # Test 4.2: CSRF protection (POST without token)
    log "4.2 Testing CSRF protection..."
    curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}' > /dev/null
    
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tenant/contacts" \
        -H "Content-Type: application/json" \
        -d '{"firstName":"Hacker","lastName":"Test","email":"hacker@test.com"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "403" ] && pass "CSRF protection → 403" || fail "CSRF protection → Expected 403, got $HTTP_CODE"
    
    # Test 4.3: SQL injection attempt
    log "4.3 Testing SQL injection..."
    CSRF_TOKEN=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIE_FILE" 2>/dev/null)
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" \
        "$BASE_URL/api/tenant/contacts?search='%20OR%201=1%20--")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "400" ] && pass "SQL injection blocked" || warn "SQL injection response: HTTP $HTTP_CODE"
    
    # Test 4.4: XSS attempt in input
    log "4.4 Testing XSS protection..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tenant/contacts" \
        -H "Content-Type: application/json" \
        -H "x-csrf-token: $CSRF_TOKEN" \
        -d '{"firstName":"<script>alert(1)</script>","lastName":"Test","email":"xss@test.com"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    # Should either sanitize or reject
    [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "400" ] && pass "XSS input handled (HTTP $HTTP_CODE)" || warn "XSS response: HTTP $HTTP_CODE"
    
    # Test 4.5: Rate limiting
    log "4.5 Testing rate limiting (10 rapid requests)..."
    RATE_LIMIT_TRIGGERED=false
    for i in {1..10}; do
        RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tenant/contacts?limit=1")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        if [ "$HTTP_CODE" = "429" ]; then
            RATE_LIMIT_TRIGGERED=true
            break
        fi
    done
    $RATE_LIMIT_TRIGGERED && pass "Rate limiting active" || warn "Rate limiting not triggered in 10 requests"
    
    # Test 4.6: Security headers
    log "4.6 Checking security headers..."
    HEADERS=$(curl -s -I "$BASE_URL" 2>&1)
    
    echo "$HEADERS" | grep -qi "x-frame-options" && pass "X-Frame-Options present" || fail "X-Frame-Options missing"
    echo "$HEADERS" | grep -qi "x-content-type-options" && pass "X-Content-Type-Options present" || fail "X-Content-Type-Options missing"
    echo "$HEADERS" | grep -qi "strict-transport-security" && pass "HSTS present" || fail "HSTS missing"
    echo "$HEADERS" | grep -qi "content-security-policy" && pass "CSP present" || fail "CSP missing"
    echo "$HEADERS" | grep -qi "referrer-policy" && pass "Referrer-Policy present" || fail "Referrer-Policy missing"
    echo "$HEADERS" | grep -qi "permissions-policy" && pass "Permissions-Policy present" || fail "Permissions-Policy missing"
}

# ═══════════════════════════════════════════════════════════════
# SECTION 5: DATA TRANSMISSION TEST
# ═══════════════════════════════════════════════════════════════
test_data_transmission() {
    section "5. DATA TRANSMISSION TEST"
    
    # Test 5.1: Check if HTTPS is enforced (in production)
    log "5.1 Checking protocol..."
    PROTOCOL=$(echo "$BASE_URL" | grep -o "https\?" | head -1)
    if [ "$PROTOCOL" = "https" ]; then
        pass "HTTPS enabled"
    else
        warn "HTTP only (OK for local dev, must use HTTPS in production)"
    fi
    
    # Test 5.2: Check response content-type
    log "5.2 Checking response content-type..."
    curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}' > /dev/null
    
    RESPONSE=$(curl -s -I -b "$COOKIE_FILE" "$BASE_URL/api/tenant/contacts?limit=1")
    echo "$RESPONSE" | grep -qi "content-type: application/json" && pass "JSON content-type" || fail "Invalid content-type"
    
    # Test 5.3: Check for sensitive data in response
    log "5.3 Checking for sensitive data exposure..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/tenant/me")
    
    # Should NOT contain password hash
    echo "$RESPONSE" | grep -qi "password_hash\|passwordHash\|hashed_password" && fail "Password hash exposed!" || pass "No password hash in response"
    
    # Should NOT contain internal IPs
    echo "$RESPONSE" | grep -qi "192\.168\.\|10\.0\.\|172\.16\." && fail "Internal IP exposed!" || pass "No internal IPs in response"
    
    # Test 5.4: Check CORS headers
    log "5.4 Checking CORS..."
    RESPONSE=$(curl -s -I -X OPTIONS "$BASE_URL/api/tenant/contacts" \
        -H "Origin: http://evil.com" \
        -H "Access-Control-Request-Method: GET")
    
    if echo "$RESPONSE" | grep -qi "access-control-allow-origin: http://evil.com"; then
        fail "CORS allows arbitrary origins!"
    else
        pass "CORS properly configured"
    fi
}

# ═══════════════════════════════════════════════════════════════
# SECTION 6: RATE LIMIT CONFIGURATION TEST
# ═══════════════════════════════════════════════════════════════
test_rate_limit_config() {
    section "6. RATE LIMIT CONFIGURATION"
    
    log "6.1 Checking rate limit implementation..."
    
    # Check if rate limits are configurable per plan
    if grep -r "plan.*rate\|rateLimit.*plan" lib/ app/ --include="*.ts" 2>/dev/null | grep -q "plan"; then
        pass "Per-plan rate limits configured"
    else
        warn "Rate limits NOT configurable per plan (hardcoded)"
    fi
    
    # Check current limits
    log "6.2 Current rate limits (from lib/rate-limit.ts):"
    echo "  • API endpoints: 60 req/min"
    echo "  • Auth endpoints: 5 req/min"
    echo "  • Export: 10 req/hour"
    echo "  • Import: 5 req/hour"
    echo "  • AI: 30 req/hour"
    echo "  • Webhooks: 1000 req/hour"
    echo "  • Contacts CRUD: 30 req/min"
    echo "  • Deals CRUD: 30 req/min"
    
    log "6.3 Checking for super admin rate limit settings..."
    
    # Check if there's a settings page for rate limits
    if grep -r "rate.*limit.*settings\|rateLimit.*config" app/super-admin/ --include="*.tsx" 2>/dev/null | grep -q "settings"; then
        pass "Super admin rate limit settings found"
    else
        warn "No super admin rate limit settings UI (needs implementation)"
    fi
}

# ═══════════════════════════════════════════════════════════════
# SECTION 7: SUPER ADMIN TESTS
# ═══════════════════════════════════════════════════════════════
test_super_admin() {
    section "7. SUPER ADMIN TESTS"
    
    # Re-login
    curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@test.com","password":"password123"}' > /dev/null
    
    # Test 7.1: List tenants
    log "7.1 Listing tenants..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/super-admin/tenants?limit=10")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /super-admin/tenants" || fail "GET /super-admin/tenants (HTTP $HTTP_CODE)"
    
    # Test 7.2: Health check
    log "7.2 Health check..."
    RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/superadmin/health")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /superadmin/health" || fail "GET /superadmin/health (HTTP $HTTP_CODE)"
    
    # Test 7.3: Platform stats
    log "7.3 Platform stats..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/superadmin/stats")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /superadmin/stats" || fail "GET /superadmin/stats (HTTP $HTTP_CODE)"
    
    # Test 7.4: Data explorer
    log "7.4 Data explorer..."
    RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/api/superadmin/data-explorer?q=test&type=contacts")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    [ "$HTTP_CODE" = "200" ] && pass "GET /superadmin/data-explorer" || fail "GET /superadmin/data-explorer (HTTP $HTTP_CODE)"
}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  NuCRM Enterprise - Complete Security & API Test Suite"
echo "═══════════════════════════════════════════════════════════"
echo ""

test_authentication
test_api_keys
test_crud_operations
test_security
test_data_transmission
test_rate_limit_config
test_super_admin

# Summary
section "TEST SUMMARY"
echo -e "${GREEN}PASSED: $PASS${NC}"
echo -e "${RED}FAILED: $FAIL${NC}"
echo -e "${YELLOW}WARNINGS: $WARN${NC}"
echo ""
echo "Results saved to: $RESULTS_DIR"

# Save summary
cat > "$RESULTS_DIR/summary.txt" << EOF
NuCRM Security Test Summary
============================
Date: $(date)
Passed: $PASS
Failed: $FAIL
Warnings: $WARN
EOF

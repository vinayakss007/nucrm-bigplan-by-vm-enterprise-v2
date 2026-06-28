# NuCRM API - Known Issues & Troubleshooting

> **Last Updated**: June 28, 2026
>
> **Purpose**: Document known API issues and fixes for testing

---

## Known Issues from Test Suite

### 1. CSRF Token Required for POST/PUT/DELETE

**Issue**: POST requests fail with `400 CSRF token missing or invalid`

**Fix**: Extract CSRF token from cookie after login:

```bash
# Login and save cookies
curl -c cookies.txt -X POST localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# Extract CSRF token from cookie file
CSRF_TOKEN=$(grep -oP 'nucrm_csrf_token\s+\K\S+' cookies.txt)

# Use CSRF token in header
curl -b cookies.txt -X POST localhost:3000/api/tenant/contacts \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d '{"firstName":"Test","lastName":"User","email":"test@example.com"}'
```

**Alternative**: Use API Key auth (bypasses CSRF):

```bash
curl -H "Authorization: Bearer ak_live_xxxxx" \
  -H "Content-Type: application/json" \
  -X POST localhost:3000/api/tenant/contacts \
  -d '{"firstName":"Test","lastName":"User","email":"test@example.com"}'
```

---

### 2. Dashboard Stats Endpoints

**Incorrect Path in Test Script**:
- ❌ `/api/tenant/dashboard/stats/contacts` → 404
- ❌ `/api/tenant/dashboard/stats/pipeline` → 404
- ❌ `/api/tenant/dashboard/stats/revenue` → 404
- ❌ `/api/tenant/dashboard/stats/tasks` → 404

**Correct Path**:
- ✅ `/api/tenant/dashboard/stats` → Returns all stats in one response
- ✅ `/api/tenant/dashboard/widgets/leads` → Leads widget
- ✅ `/api/tenant/dashboard/widgets/tasks` → Tasks widget

**Response Structure**:
```json
{
  "data": {
    "contactCount": 56,
    "companyCount": 30,
    "pendingTasks": 12,
    "pipeline": 8695995,
    "totalDeals": 35,
    "dealsThisMonthValue": 8695995,
    "newContactsThisMonth": 56,
    "wonThisMonth": 0,
    "activities": [...],
    "tasks": [],
    "dealsByStage": [...],
    "recentContacts": [...],
    "upcomingDeals": [...]
  }
}
```

---

### 3. API Key Authentication Fails (401)

**Issue**: API key created but returns 401 when used

**Possible Causes**:
1. API key not yet propagated (wait 1-2 seconds)
2. API key stored with different tenant context
3. Key prefix mismatch

**Debug Steps**:
```bash
# List existing API keys
curl -b cookies.txt localhost:3000/api/tenant/api-keys

# Create new key and capture full response
curl -b cookies.txt -X POST localhost:3000/api/tenant/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name":"test-key","scopes":["*"],"expires_in_days":7}' | python3 -m json.tool

# Test immediately with the returned key
curl -H "Authorization: Bearer ak_live_RETURNED_KEY_HERE" \
  localhost:3000/api/tenant/contacts?limit=1
```

---

### 4. Audit Logs Returns 500

**Issue**: `GET /api/super-admin/audit-logs` returns 500

**Possible Causes**:
- Missing audit_log table columns
- Migration not run

**Workaround**: Use Data Explorer for audit data:
```bash
curl -b cookies.txt "localhost:3000/api/superadmin/data-explorer?type=contacts&q=&page=1&limit=10"
```

---

## Corrected Test Script Commands

### Dashboard Test (Fixed)

```bash
# Correct endpoint
curl -b cookies.txt localhost:3000/api/tenant/dashboard/stats | python3 -m json.tool

# Widgets
curl -b cookies.txt localhost:3000/api/tenant/dashboard/widgets/leads
curl -b cookies.txt localhost:3000/api/tenant/dashboard/widgets/tasks
curl -b cookies.txt localhost:3000/api/tenant/dashboard/widgets/contacts/recent
```

### Contacts Test (with CSRF)

```bash
# Login first
curl -c cookies.txt -X POST localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# Get CSRF token
CSRF=$(grep -oP 'nucrm_csrf_token\s+\K\S+' cookies.txt)

# Create contact with CSRF
curl -b cookies.txt -X POST localhost:3000/api/tenant/contacts \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"firstName":"Test","lastName":"User","email":"test@example.com"}'
```

---

## Complete Working Examples

### Full CRUD Test

```bash
#!/bin/bash
BASE="http://localhost:3000"
COOKIES="/tmp/nucrm_test_cookies.txt"

# 1. Login
echo "1. Logging in..."
curl -s -c "$COOKIES" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}' > /dev/null

# 2. Get CSRF
CSRF=$(grep -oP 'nucrm_csrf_token\s+\K\S+' "$COOKIES")
echo "   CSRF token: ${CSRF:0:10}..."

# 3. List contacts
echo "2. Listing contacts..."
curl -s -b "$COOKIES" "$BASE/api/tenant/contacts?limit=2" | python3 -m json.tool

# 4. Create contact
echo "3. Creating contact..."
RESPONSE=$(curl -s -b "$COOKIES" -X POST "$BASE/api/tenant/contacts" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"firstName":"API","lastName":"Test","email":"api.test@example.com"}')
echo "$RESPONSE" | python3 -m json.tool

# 5. Get created contact ID
CONTACT_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))")
echo "   Created ID: $CONTACT_ID"

# 6. Get contact by ID
echo "4. Getting contact by ID..."
curl -s -b "$COOKIES" "$BASE/api/tenant/contacts/$CONTACT_ID" | python3 -m json.tool

# 7. Update contact
echo "5. Updating contact..."
curl -s -b "$COOKIES" -X PUT "$BASE/api/tenant/contacts/$CONTACT_ID" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"firstName":"Updated"}' | python3 -m json.tool

# 8. Delete contact
echo "6. Deleting contact..."
curl -s -b "$COOKIES" -X DELETE "$BASE/api/tenant/contacts/$CONTACT_ID" \
  -H "x-csrf-token: $CSRF" -w "\nHTTP Status: %{http_code}\n"

echo ""
echo "✅ CRUD test complete!"
```

---

## API Reference (Verified Endpoints)

### Working Endpoints

| Method | Endpoint | Status |
|--------|----------|--------|
| `POST` | `/api/auth/login` | ✅ |
| `POST` | `/api/auth/logout` | ✅ |
| `GET` | `/api/auth/csrf-token` | ✅ |
| `GET` | `/api/tenant/me` | ✅ |
| `GET` | `/api/tenant/contacts` | ✅ |
| `POST` | `/api/tenant/contacts` | ✅ (needs CSRF) |
| `GET` | `/api/tenant/contacts/:id` | ✅ |
| `PUT` | `/api/tenant/contacts/:id` | ✅ (needs CSRF) |
| `DELETE` | `/api/tenant/contacts/:id` | ✅ (needs CSRF) |
| `GET` | `/api/tenant/leads` | ✅ |
| `GET` | `/api/tenant/deals` | ✅ |
| `GET` | `/api/tenant/companies` | ✅ |
| `GET` | `/api/tenant/tasks` | ✅ |
| `GET` | `/api/tenant/dashboard/stats` | ✅ |
| `GET` | `/api/tenant/dashboard/widgets/*` | ✅ |
| `GET` | `/api/tenant/api-keys` | ✅ |
| `POST` | `/api/tenant/api-keys` | ✅ |
| `GET` | `/api/super-admin/tenants` | ✅ |
| `GET` | `/api/superadmin/health` | ✅ |
| `GET` | `/api/superadmin/stats` | ✅ |
| `GET` | `/api/superadmin/data-explorer` | ✅ |

### Problematic Endpoints

| Method | Endpoint | Issue |
|--------|----------|-------|
| `GET` | `/api/super-admin/audit-logs` | 500 error |
| `GET` | `/api/tenant/dashboard/stats/contacts` | 404 (use `/stats`) |
| `GET` | `/api/tenant/dashboard/stats/pipeline` | 404 (use `/stats`) |

---

## Quick Reference

```bash
# Login
curl -c cookies.txt -X POST localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# Get CSRF
CSRF=$(grep -oP 'nucrm_csrf_token\s+\K\S+' cookies.txt)

# List contacts (no CSRF needed)
curl -b cookies.txt localhost:3000/api/tenant/contacts?limit=5

# Create contact (needs CSRF)
curl -b cookies.txt -X POST localhost:3000/api/tenant/contacts \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"firstName":"Test","lastName":"User","email":"test@example.com"}'

# Use API key (no CSRF needed)
curl -H "Authorization: Bearer ak_live_xxxxx" \
  localhost:3000/api/tenant/contacts?limit=5
```

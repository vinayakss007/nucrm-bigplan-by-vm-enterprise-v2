# NuCRM Enterprise API - External Tester Setup Guide

## Quick Start

### 1. Prerequisites
- Postman (v10+ recommended)
- Access to the running instance at `http://localhost:3000`

### 2. Postman Environment Setup
1. Open Postman → Environments → Import
2. Import: `postman/NuCRM-Test-Test-Environment.postman_environment.json`
3. Select the **NuCRM Local Test** environment

### 3. Collection Setup
1. Import: `postman/NuCRM-API-Collection.postman_collection.json`
2. The collection auto-uses `{{base_url}}` from the environment

## Credentials

| Role | Email | Password | Access Level |
|------|-------|----------|-------------|
| **Super Admin** | `admin@test.com` | `password123` | All tenants, superadmin endpoints |
| **Org Admin** | `manager@test.com` | `password123` | Full tenant admin |
| **Sales Rep 1** | `rep1@test.com` | `password123` | Standard user |
| **Sales Rep 2** | `rep2@test.com` | `password123` | Standard user |

**Tenant Slug:** `demo`

## Authentication Flow

### Method 1: Session Cookie (Recommended)
1. Run **00 - Auth Setup → Login (Super Admin)**
2. The `nucrm_session` cookie is auto-stored
3. All subsequent requests use the cookie automatically

### Method 2: API Key
> **Note:** API key auth has a known bug. Use session cookie auth instead.
>
> If you need API keys, create them via the collection, but the bearer token
> auth does not currently validate correctly.

## CSRF Protection

All **state-changing requests** (POST, PUT, PATCH, DELETE) require a CSRF token:

1. Run **00 - Auth Setup → Get CSRF Token** after login
2. The token is returned in the response body and stored in a cookie
3. The collection auto-includes the `X-CSRF-Token` header

### Manual cURL Example
```bash
# Login
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","password":"password123"}'

# Get CSRF token
curl -b cookies.txt -c cookies.txt http://localhost:3000/api/auth/csrf-token

# Create contact (read token from response or cookie)
CSRF=$(python3 -c "import json; print(json.load(open('response.json'))['token'])")
curl -b cookies.txt -X POST http://localhost:3000/api/tenant/contacts \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"first_name":"John","last_name":"Doe","email":"john@example.com"}'
```

## API Endpoints Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login (returns session cookie) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/csrf-token` | Get CSRF token |
| GET | `/api/auth/me` | Get current user |

### Contacts (CRM)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tenant/contacts` | List contacts (paginated) |
| POST | `/api/tenant/contacts` | Create contact |
| GET | `/api/tenant/contacts/:id` | Get contact |
| PUT | `/api/tenant/contacts/:id` | Update contact |
| DELETE | `/api/tenant/contacts/:id` | Delete contact |

### Leads
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tenant/leads` | List leads |
| POST | `/api/tenant/leads` | Create lead |
| GET | `/api/tenant/leads/:id` | Get lead |
| PUT | `/api/tenant/leads/:id` | Update lead |
| POST | `/api/tenant/leads/:id/convert` | Convert lead to deal |

### Deals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tenant/deals` | List deals |
| POST | `/api/tenant/deals` | Create deal |
| GET | `/api/tenant/deals/:id` | Get deal |
| PUT | `/api/tenant/deals/:id` | Update deal |
| DELETE | `/api/tenant/deals/:id` | Delete deal |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tenant/dashboard/stats` | Dashboard statistics |
| GET | `/api/tenant/dashboard/pipeline` | Pipeline overview |
| GET | `/api/tenant/dashboard/revenue` | Revenue stats |

### Super Admin (requires super admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/superadmin/stats` | Platform-wide stats |
| GET | `/api/superadmin/tenants` | List all tenants |
| GET | `/api/superadmin/audit` | Audit logs |

### Security Tests
| Method | Endpoint | Expected |
|--------|----------|----------|
| GET | `/api/tenant/contacts` (no auth) | 401 |
| GET | `/api/superadmin/stats` (regular user) | 403 |
| POST | `/api/tenant/contacts` (invalid CSRF) | 403 |

## Testing Workflow

1. **Login** → Get session cookie
2. **Get CSRF Token** → Required for writes
3. **CRUD Tests** → Create, Read, Update, Delete contacts/leads/deals
4. **Role Tests** → Login as different users, verify access controls
5. **Security Tests** → Unauth access, CSRF bypass, role escalation

## Known Issues

1. **API Key Auth Bug:** Bearer token authentication does not work despite correct SHA-256 hash in database. Use session cookie auth.
2. **Field Naming:** API uses `snake_case` for input (`first_name`, `last_name`) but returns `camelCase` in responses (`firstName`, `lastName`).

## Troubleshooting

- **401 Unauthorized:** Re-run the Login request
- **403 CSRF Error:** Re-run Get CSRF Token, ensure X-CSRF-Token header is set
- **Connection Refused:** Verify the server is running on port 3000
- **Empty Response:** Check if you're hitting the correct endpoint path

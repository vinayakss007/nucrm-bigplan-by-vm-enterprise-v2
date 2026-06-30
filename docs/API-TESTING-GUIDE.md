# NuCRM Enterprise API Testing Guide

> **Purpose**: Complete REST API documentation for Phase 1 (current) and migration reference for Phase 2 (GraphQL)
>
> **Last Updated**: June 28, 2026
>
> **Base URL**: `http://localhost:3000` (local) or `https://your-domain.com` (production)

---

## Table of Contents

1. [Authentication](#authentication)
2. [Security Model](#security-model)
3. [API Endpoints Reference](#api-endpoints-reference)
4. [Error Handling](#error-handling)
5. [Postman Collection](#postman-collection)
6. [CLI Test Suite](#cli-test-suite)
7. [GraphQL Migration Notes](#graphql-migration-notes)

---

## Authentication

NuCRM supports two authentication methods:

### Method 1: Session Cookie (Browser/Postman)

```bash
# Login and save cookies
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# Use cookies for subsequent requests
curl -b cookies.txt http://localhost:3000/api/tenant/contacts
```

### Method 2: API Key (External Integrations)

```bash
# First, create an API key via UI or API
curl -b cookies.txt -X POST http://localhost:3000/api/tenant/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name":"my-integration","scopes":["*"],"expires_in_days":30}'

# Use API key (bypasses CSRF!)
curl -H "Authorization: Bearer ak_live_xxxxx" \
  http://localhost:3000/api/tenant/contacts
```

### API Key Scopes

| Scope | Description |
|-------|-------------|
| `*` | Full access (all permissions) |
| `contacts:read` | Read contacts |
| `contacts:write` | Create/update contacts |
| `contacts:list` | List contacts |
| `deals:all` | Full deal access |
| `leads:all` | Full lead access |
| `companies:all` | Full company access |
| `tasks:all` | Full task access |

---

## Security Model

### CSRF Protection

All state-changing requests (POST/PUT/DELETE) via cookie auth require CSRF token:

```bash
# Get CSRF token from cookie
# The cookie 'nucrm_csrf_token' is set on login

# Include in header
curl -b cookies.txt -X POST http://localhost:3000/api/tenant/contacts \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"User"}'
```

**Note**: API Key auth bypasses CSRF (use for external integrations).

### Rate Limiting

- **100 requests/minute** per user
- **100 requests/hour** for contact creation
- Exceeding returns `429 Too Many Requests`

### Row-Level Security (RLS)

All data is isolated by `tenant_id`. Users can only see their tenant's data unless they have Super Admin role.

---

## API Endpoints Reference

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Login with email/password |
| `POST` | `/api/auth/logout` | Logout (clear session) |
| `GET` | `/api/auth/csrf-token` | Get CSRF token |
| `POST` | `/api/setup/create-admin` | Create initial admin (first run) |

#### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@test.com",
  "password": "password123"
}
```

**Response** (200 OK):
```json
{
  "user": {
    "id": "usr_xxx",
    "email": "admin@test.com",
    "fullName": "Admin User",
    "isSuperAdmin": true
  },
  "tenant": {
    "id": "tnt_xxx",
    "name": "My Company"
  }
}
```

---

### Contacts API

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/tenant/contacts` | `contacts.list` | List contacts |
| `POST` | `/api/tenant/contacts` | `contacts.create` | Create contact |
| `GET` | `/api/tenant/contacts/:id` | `contacts.read` | Get contact |
| `PUT` | `/api/tenant/contacts/:id` | `contacts.update` | Update contact |
| `DELETE` | `/api/tenant/contacts/:id` | `contacts.delete` | Delete contact |
| `GET` | `/api/tenant/contacts/export` | `contacts.export` | Export contacts CSV |
| `POST` | `/api/tenant/contacts/bulk` | `contacts.create` | Bulk create |
| `GET` | `/api/tenant/contacts/:id/timeline` | `contacts.read` | Contact timeline |
| `GET` | `/api/tenant/contacts/:id/notes` | `contacts.read` | Contact notes |

#### List Contacts

```http
GET /api/tenant/contacts?limit=50&offset=0&q=search&lead_status=new&company_id=cmp_xxx
```

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Max results (default: 50, max: 500) |
| `offset` | number | Pagination offset |
| `q` | string | Search (name, email, phone) |
| `lead_status` | string | Filter by status |
| `company_id` | string | Filter by company |

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "cnt_xxx",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "+1-555-0100",
      "leadStatus": "new",
      "leadSource": "website",
      "score": 85,
      "companyName": "Acme Inc",
      "assignedName": "Sales Rep",
      "tags": ["vip", "enterprise"],
      "customFields": {},
      "createdAt": "2026-06-01T10:00:00Z"
    }
  ],
  "total": 150,
  "offset": 0,
  "limit": 50
}
```

#### Create Contact

```http
POST /api/tenant/contacts
Content-Type: application/json
x-csrf-token: xxx

{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+1-555-0100",
  "job_title": "CTO",
  "company_id": "cmp_xxx",
  "lead_status": "new",
  "lead_source": "linkedin",
  "tags": ["enterprise", "q4-2026"],
  "notes": "Met at conference",
  "custom_fields": {
    "company_size": "500+",
    "budget": "100k+"
  }
}
```

**Response** (201 Created):
```json
{
  "data": {
    "id": "cnt_new_xxx",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    ...
  }
}
```

**Error** (409 Conflict - Duplicate):
```json
{
  "error": "A contact with email john@example.com already exists: John Smith",
  "duplicate_id": "cnt_existing_xxx",
  "is_duplicate": true
}
```

---

### Leads API

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/tenant/leads` | `leads.list` | List leads |
| `POST` | `/api/tenant/leads` | `leads.create` | Create lead |
| `GET` | `/api/tenant/leads/:id` | `leads.read` | Get lead |
| `PUT` | `/api/tenant/leads/:id` | `leads.update` | Update lead |
| `DELETE` | `/api/tenant/leads/:id` | `leads.delete` | Delete lead |
| `POST` | `/api/tenant/leads/:id/convert` | `leads.convert` | Convert to deal |
| `POST` | `/api/tenant/leads/bulk` | `leads.create` | Bulk import |

#### Convert Lead to Deal

```http
POST /api/tenant/leads/:id/convert
Content-Type: application/json

{
  "dealName": "Enterprise Deal",
  "value": 50000,
  "pipeline_id": "pipe_xxx",
  "stage_id": "stage_xxx"
}
```

---

### Deals API

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/tenant/deals` | `deals.list` | List deals |
| `POST` | `/api/tenant/deals` | `deals.create` | Create deal |
| `GET` | `/api/tenant/deals/:id` | `deals.read` | Get deal |
| `PUT` | `/api/tenant/deals/:id` | `deals.update` | Update deal |
| `DELETE` | `/api/tenant/deals/:id` | `deals.delete` | Delete deal |

#### List Deals with Pipeline Filter

```http
GET /api/tenant/deals?limit=50&stage_id=stage_xxx&pipeline_id=pipe_xxx
```

---

### Companies API

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/tenant/companies` | `companies.list` | List companies |
| `POST` | `/api/tenant/companies` | `companies.create` | Create company |
| `GET` | `/api/tenant/companies/:id` | `companies.read` | Get company |
| `PUT` | `/api/tenant/companies/:id` | `companies.update` | Update company |
| `DELETE` | `/api/tenant/companies/:id` | `companies.delete` | Delete company |

---

### Tasks API

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/tenant/tasks` | `tasks.list` | List tasks |
| `POST` | `/api/tenant/tasks` | `tasks.create` | Create task |
| `GET` | `/api/tenant/tasks/:id` | `tasks.read` | Get task |
| `PUT` | `/api/tenant/tasks/:id` | `tasks.update` | Update task |
| `DELETE` | `/api/tenant/tasks/:id` | `tasks.delete` | Delete task |

#### List Tasks with Date Filter

```http
GET /api/tenant/tasks?limit=100&due_start=2026-06-01&due_end=2026-06-30
```

---

### Dashboard API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/dashboard` | Full dashboard data |
| `GET` | `/api/tenant/dashboard/stats/contacts` | Contact statistics |
| `GET` | `/api/tenant/dashboard/stats/pipeline` | Pipeline stats |
| `GET` | `/api/tenant/dashboard/stats/revenue` | Revenue stats |
| `GET` | `/api/tenant/dashboard/stats/tasks` | Task stats |
| `GET` | `/api/tenant/dashboard/widgets/contacts/recent` | Recent contacts |
| `GET` | `/api/tenant/dashboard/widgets/leads` | Leads widget |
| `GET` | `/api/tenant/dashboard/widgets/tasks` | Tasks widget |
| `GET` | `/api/tenant/dashboard/widgets/activity` | Activity feed |
| `GET` | `/api/tenant/dashboard/widgets/follow-ups` | Follow-ups |
| `GET` | `/api/tenant/dashboard/widgets/deals/closing` | Deals closing soon |
| `GET` | `/api/tenant/dashboard/widgets/invoices` | Invoices widget |
| `GET` | `/api/tenant/dashboard/widgets/tickets` | Support tickets |
| `GET` | `/api/tenant/dashboard/layout` | Dashboard layout config |
| `PUT` | `/api/tenant/dashboard/layout` | Update layout |

---

### Super Admin API

Requires `isSuperAdmin: true`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/super-admin/tenants` | List all tenants |
| `GET` | `/api/super-admin/tenants/:id` | Get tenant details |
| `POST` | `/api/super-admin/tenants` | Create tenant |
| `PUT` | `/api/super-admin/tenants/:id` | Update tenant |
| `DELETE` | `/api/super-admin/tenants/:id` | Delete tenant |
| `GET` | `/api/super-admin/audit-logs` | Audit logs |
| `GET` | `/api/superadmin/health` | Health check |
| `GET` | `/api/superadmin/stats` | Platform stats |
| `GET` | `/api/superadmin/monitoring` | System monitoring |
| `GET` | `/api/superadmin/errors` | Error logs |
| `GET` | `/api/superadmin/recent-activity` | Recent activity |
| `GET` | `/api/superadmin/adoption` | Adoption metrics |
| `GET` | `/api/superadmin/usage` | Usage stats |
| `GET` | `/api/superadmin/plans` | Billing plans |
| `GET` | `/api/superadmin/modules` | Module management |
| `GET` | `/api/superadmin/token-control` | Token budget control |

#### Data Explorer (Cross-Tenant Search)

```http
GET /api/superadmin/data-explorer?q=search&type=contacts&tenantId=tnt_xxx&page=1&limit=50
```

**Parameters**:
| Param | Description |
|-------|-------------|
| `q` | Search term (ILIKE across fields) |
| `type` | `all`, `contacts`, `leads`, `deals`, `companies`, `users`, `tenants` |
| `tenantId` | Filter by specific tenant |
| `field` | Exact field match |
| `value` | Value for exact match |
| `page` | Page number |
| `limit` | Results per page (max 200) |
| `sort` | Sort column |
| `order` | `asc` or `desc` |
| `action` | `summary` for stats, `schema` for DB schema |

---

### Documents API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/documents` | List documents |
| `POST` | `/api/tenant/documents/upload-url` | Get presigned upload URL |
| `GET` | `/api/tenant/documents/:id` | Get document |
| `DELETE` | `/api/tenant/documents/:id` | Delete document |

---

### Forms API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/forms` | List forms |
| `POST` | `/api/tenant/forms` | Create form |
| `GET` | `/api/tenant/forms/:id` | Get form |
| `PUT` | `/api/tenant/forms/:id` | Update form |
| `DELETE` | `/api/tenant/forms/:id` | Delete form |
| `GET` | `/api/tenant/forms/public/:id` | Public form (no auth) |

---

### API Keys Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/api-keys` | List API keys |
| `POST` | `/api/tenant/api-keys` | Create API key |
| `DELETE` | `/api/tenant/api-keys/:id` | Revoke API key |

---

### User/Profile API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/me` | Current user info |
| `GET` | `/api/user/profile` | User profile |
| `PUT` | `/api/user/profile` | Update profile |
| `GET` | `/api/user/preferences` | User preferences |
| `PUT` | `/api/user/preferences` | Update preferences |
| `GET` | `/api/user/sessions` | Active sessions |
| `POST` | `/api/user/password` | Change password |
| `GET` | `/api/user/telegram` | Telegram settings |

---

### Tenant Settings API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/workspace` | Workspace info |
| `GET` | `/api/tenant/usage-status` | Usage/limits |
| `GET` | `/api/tenant/roles` | List roles |
| `POST` | `/api/tenant/roles` | Create role |
| `GET` | `/api/tenant/custom-fields` | Custom fields |
| `POST` | `/api/tenant/custom-fields` | Create custom field |
| `GET` | `/api/tenant/integrations` | List integrations |
| `GET` | `/api/tenant/admin/ai-providers` | AI providers config |
| `GET` | `/api/tenant/admin/lead-scoring` | Lead scoring rules |
| `GET` | `/api/tenant/admin/login-policy` | Login policy |
| `GET` | `/api/tenant/admin/picklists` | Picklist values |
| `GET` | `/api/tenant/admin/localization` | Localization settings |

---

### Billing API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/billing/invoices` | List invoices |
| `GET` | `/api/tenant/billing/portal` | Billing portal URL |
| `POST` | `/api/tenant/billing/checkout` | Create checkout session |
| `GET` | `/api/tenant/billing/modules` | Module billing |
| `POST` | `/api/tenant/billing/stripe` | Stripe webhook |

---

### AI API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/ai/models` | List AI models |
| `GET` | `/api/tenant/ai-keys` | List AI keys |
| `POST` | `/api/tenant/ai-keys` | Create AI key |
| `GET` | `/api/tenant/ai/credits` | AI credit balance |
| `GET` | `/api/tenant/ai/activity` | AI activity log |
| `POST` | `/api/tenant/ai/score` | Score leads |

---

### WhatsApp API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/whatsapp/templates` | List templates |
| `GET` | `/api/tenant/whatsapp/messages` | List messages |
| `POST` | `/api/tenant/whatsapp/send` | Send message |

---

### Public API (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/public/kb/articles` | Knowledge base articles |
| `GET` | `/api/public/kb/articles/:id` | Get article |
| `GET` | `/api/public/offers/:token` | View offer |
| `POST` | `/api/public/offers/:token/accept` | Accept offer |
| `POST` | `/api/public/offers/:token/decline` | Decline offer |
| `POST` | `/api/public/tickets` | Submit support ticket |
| `GET` | `/api/public/invoices` | Public invoice lookup |

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No Content (delete) |
| `400` | Bad Request (validation) |
| `401` | Unauthorized (no auth) |
| `403` | Forbidden (no permission) |
| `404` | Not Found |
| `409` | Conflict (duplicate) |
| `429` | Rate Limited |
| `500` | Server Error |

### Common Errors

**401 Unauthorized**:
```json
{ "error": "Authentication required" }
```

**403 Forbidden**:
```json
{ "error": "Insufficient permissions" }
```

**409 Conflict (Duplicate)**:
```json
{
  "error": "A contact with email x@y.com already exists: Existing Name",
  "duplicate_id": "cnt_xxx",
  "is_duplicate": true
}
```

**429 Rate Limited**:
```json
{ "error": "Rate limit exceeded. Try again in 60 seconds." }
```

---

## Postman Collection

### Import Instructions

1. Open Postman
2. Click **Import** → **File**
3. Select `postman/NuCRM-API-Collection.postman_collection.json`
4. Set environment variable `base_url` to `http://localhost:3000`

### Collection Structure

```
NuCRM Enterprise API
├── 00 - Auth Setup
│   ├── Login (Super Admin)
│   ├── Login (Org Admin)
│   ├── Get CSRF Token
│   ├── Get Current User
│   └── Logout
├── 01 - API Keys
│   ├── List API Keys
│   ├── Create API Key (Full Access)
│   ├── Create API Key (Read-Only)
│   ├── Create API Key (Scoped)
│   ├── Test API Key Auth
│   └── Revoke API Key
├── 02 - Contacts
│   ├── List Contacts
│   ├── Create Contact
│   ├── Get Contact by ID
│   ├── Update Contact
│   ├── Delete Contact
│   ├── Search Contacts
│   ├── Bulk Create
│   ├── Export Contacts
│   ├── Contact Timeline
│   └── Get Contact Notes
├── 03 - Leads
│   ├── List/Create/Update/Delete
│   ├── Convert Lead to Deal
│   └── Bulk Import
├── 04 - Deals
│   ├── CRUD Operations
│   └── Pipeline Management
├── 05 - Super Admin
│   ├── Tenant Management
│   └── Audit Logs
├── 06 - Tenant Admin
│   ├── Workspace Settings
│   ├── Roles & Permissions
│   ├── AI Providers
│   └── Security Settings
├── 07 - Dashboard
│   ├── Stats Endpoints
│   └── Widget Endpoints
├── 08 - Forms
├── 09 - Documents
└── 10 - Security Tests
    ├── Unauthenticated Access (401)
    ├── Super Admin with Regular User (403)
    ├── Invalid API Key (401)
    └── Cross-Tenant Access (RLS)
```

---

## CLI Test Suite

### Quick Start

```bash
# Run all tests
bash postman/test-api.sh all

# Run specific test groups
bash postman/test-api.sh login      # Login only
bash postman/test-api.sh contacts   # Contacts CRUD
bash postman/test-api.sh leads      # Leads CRUD
bash postman/test-api.sh deals      # Deals CRUD
bash postman/test-api.sh dashboard  # Dashboard endpoints
bash postman/test-api.sh superadmin # Super Admin endpoints
bash postman/test-api.sh apikey     # Create & test API key
bash postman/test-api.sh security   # Security tests
```

### Test Output

```
═══════════════════════════════════════════════════════════
  NuCRM Enterprise API Test Suite
═══════════════════════════════════════════════════════════

[07:44:28] Logging in as Super Admin...
✅ PASS - Super Admin login successful
[07:44:28] Testing Contacts API...
✅ PASS - GET /contacts
✅ PASS - POST /contacts (created: cnt_xxx)
✅ PASS - GET /contacts/cnt_xxx
✅ PASS - PUT /contacts/cnt_xxx
✅ PASS - DELETE /contacts/cnt_xxx
...
═══════════════════════════════════════════════════════════
  Results saved to: /tmp/nucrm-test-results
═══════════════════════════════════════════════════════════
```

### Programmatic Usage

```bash
# Source the functions
source postman/test-api.sh

# Login
login_super_admin

# Run specific test
test_contacts

# Use API key for external calls
create_api_key
test_api_key_auth
```

---

## GraphQL Migration Notes

### Phase 2: REST → GraphQL Mapping

| REST Endpoint | GraphQL Equivalent |
|---------------|-------------------|
| `GET /api/tenant/contacts` | `query { contacts { ... } }` |
| `POST /api/tenant/contacts` | `mutation { createContact(input: {...}) { ... } }` |
| `GET /api/tenant/deals` | `query { deals { ... } }` |
| `GET /api/superadmin/data-explorer` | `query { globalSearch(q: "...") { ... } }` |

### Schema Structure for GraphQL

```graphql
type Contact {
  id: ID!
  firstName: String!
  lastName: String
  email: String
  phone: String
  leadStatus: String
  leadSource: String
  score: Int
  company: Company
  assignedTo: User
  tags: [String]
  customFields: JSON
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Query {
  contacts(limit: Int, offset: Int, q: String): ContactConnection!
  contact(id: ID!): Contact
  deals(limit: Int, stageId: ID): DealConnection!
  globalSearch(q: String!, type: String): GlobalSearchResult!
}

type Mutation {
  createContact(input: ContactInput!): Contact!
  updateContact(id: ID!, input: ContactInput!): Contact!
  deleteContact(id: ID!): Boolean!
}
```

### Key Differences

| Feature | REST | GraphQL |
|---------|------|---------|
| Endpoint | Multiple URLs | Single `/graphql` |
| Data fetching | Fixed response | Client specifies fields |
| Versioning | `/v1`, `/v2` | Schema evolution |
| Documentation | External (OpenAPI) | Self-documenting |
| Batching | Multiple requests | Single request |

### Migration Checklist

- [ ] Design GraphQL schema
- [ ] Implement resolvers
- [ ] Add authentication middleware
- [ ] Set up DataLoader for N+1 prevention
- [ ] Create migration scripts
- [ ] Update Postman collection → GraphQL queries
- [ ] Update test suite
- [ ] Deprecation notices on REST endpoints

---

## Environment Variables

```env
# Required
DATABASE_URL=postgresql://nucrm:nucrm_secure_password@localhost:5432/nucrm
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-secret-key
CSRF_SECRET=your-csrf-secret

# Optional - AI
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# Optional - Email
RESEND_API_KEY=re_xxx

# Optional - Payments
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## Quick Reference Card

```bash
# Login
curl -c cookies.txt -X POST localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# List contacts (cookie auth)
curl -b cookies.txt localhost:3000/api/tenant/contacts?limit=5

# Create contact (API key)
curl -H "Authorization: Bearer ak_live_xxxxx" \
  -H "Content-Type: application/json" \
  -X POST localhost:3000/api/tenant/contacts \
  -d '{"first_name":"Test","last_name":"User","email":"test@example.com"}'

# Search across tenants (Super Admin)
curl -b cookies.txt "localhost:3000/api/superadmin/data-explorer?q=john&type=contacts"

# Health check
curl localhost:3000/api/superadmin/health
```

# API Migration Guide: v1 → v2

> **Note:** This document is retained for historical and reference purposes only.
> The v1 API has been fully removed. If you still have code targeting `/api/v1/*`,
> use the migration steps below to update to v2.

## Overview

The NuCRM API v1 (`/api/v1/*`) has been **removed**. All `/api/v1/*` endpoints are no longer available.
All clients must use the v2 API (`/api/tenant/*` and `/api/auth/*`).

## Deprecation Timeline

| Date | Event |
|------|-------|
| May 2026 | v1 API marked as deprecated, deprecation headers added |
| May 2026 | **v1 API fully removed** - all `/api/v1/*` routes deleted |

## Breaking Changes

### 1. Authentication

**v1:**
```
POST /api/v1/auth/login
```

**v2:**
```
POST /api/auth/login
```

Session handling is unchanged. Cookie-based and Bearer token auth both work.

### 2. Contacts

**v1:**
```
GET  /api/v1/contacts?limit=50&offset=0
POST /api/v1/contacts
GET  /api/v1/contacts/:id
PATCH /api/v1/contacts/:id
DELETE /api/v1/contacts/:id
```

**v2:**
```
GET  /api/tenant/contacts?limit=50&offset=0
POST /api/tenant/contacts
GET  /api/tenant/contacts/:id
PATCH /api/tenant/contacts/:id
DELETE /api/tenant/contacts/:id
```

**Changes:**
- Response format changed from `{ contacts: [...] }` to `{ data: [...], pagination: { ... } }`
- Added `search` query parameter for full-text search
- Added `tags` filter parameter
- `companyId` filter now supported

### 3. Leads → Contacts

**v1:**
```
GET  /api/v1/leads
POST /api/v1/leads
```

**v2:**
```
GET  /api/tenant/contacts?type=lead
POST /api/tenant/contacts
```

**Changes:**
- Leads are now a contact type, not a separate resource
- Use `type=lead` query parameter to filter leads
- Lead-specific fields moved to `customFields`

### 4. Deals

**v1:**
```
GET  /api/v1/deals
POST /api/v1/deals
```

**v2:**
```
GET  /api/tenant/deals
POST /api/tenant/deals
```

**Changes:**
- Added `stageId`, `ownerId`, `status` filters
- Response includes pagination metadata
- Deal value now requires `currency` field

### 5. Tasks

**v1:**
```
GET  /api/v1/tasks
POST /api/v1/tasks
```

**v2:**
```
GET  /api/tenant/tasks
POST /api/tenant/tasks
```

**Changes:**
- Added `status`, `priority`, `assignedTo`, `dueDateFrom`, `dueDateTo` filters
- `relatedEntityType` and `relatedEntityId` for linking to other resources
- Priority enum changed: `normal` → `medium`

## Migration Checklist

- [ ] Update base URL from `/api/v1/` to `/api/tenant/` (or `/api/auth/` for auth)
- [ ] Update response parsing to handle new `{ data, pagination }` format
- [ ] Replace `/api/v1/leads` with `/api/tenant/contacts?type=lead`
- [ ] Update priority values: `normal` → `medium`
- [ ] Add `currency` field to deal creation requests
- [ ] Test all API integrations against v2 endpoints
- [ ] Remove v1 fallback code from your application

## Deprecation Headers

All v1 responses now include deprecation headers:

```
Deprecation: true
Sunset: Sat, 01 Dec 2026 00:00:00 GMT
Link: </api-docs#migration-v1-to-v2>; rel="deprecation"; title="Migration Guide"
X-API-Version: v1-deprecated
X-API-V2-Path: /api/tenant/contacts
```

Use these headers to detect v1 usage in your application and log warnings.

## Support

- API Documentation: `/api-docs`
- OpenAPI Spec: `/api/openapi.yaml`
- Contact: api@nucrm.com

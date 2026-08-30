# REST API Reference

The NuCRM REST API gives programmatic access to CRM data — contacts, companies, deals, tasks,
invoices, quotes, orders, contracts, and more.

> **Spec:** the authoritative, machine-readable definition is
> [`public/api/openapi.yaml`](../../../public/api/openapi.yaml) (OpenAPI 3.1). Explore it
> interactively at **`/api-docs`**. This page summarizes conventions.

---

## Base URL & version

```
https://<your-domain>/api/v2
```

The current API version is **v2**. See [Overview](./README.md#api-versions--base-urls) for v1.

## Authentication

All endpoints (except public/health) require authentication and are scoped to a tenant. See
[Authentication](./authentication.md).

---

## Resources

The API exposes CRUD-style endpoints for the core CRM resources, including:

| Resource | Example endpoints |
| --- | --- |
| **Contacts** | `GET/POST /contacts`, `GET/PUT/DELETE /contacts/{id}`, `POST /contacts/merge`, import/export |
| **Companies** | `GET/POST /companies`, `GET/PUT/DELETE /companies/{id}` |
| **Leads** | `GET/POST /leads`, `POST /leads/{id}/convert` |
| **Deals** | `GET/POST /deals`, `GET/PUT/DELETE /deals/{id}` |
| **Tasks** | `GET/POST /tasks`, `GET/PUT/DELETE /tasks/{id}` |
| **Meetings / Activities** | `GET/POST /meetings`, `GET/POST /activities` |
| **Tickets** | `GET/POST /tickets` |
| **Invoices / Quotes / Orders** | `GET/POST /invoices`, `/quotes`, `/orders` |
| **Contracts / Subscriptions / Services** | `GET/POST /contracts`, `/subscriptions`, `/services` |
| **Products** | `GET/POST /products` |
| **Forms / Sequences / Automations / Reports** | `GET/POST /forms`, `/sequences`, `/automations`, `/reports` |

> The exact list of paths, parameters, and schemas is defined in the OpenAPI spec — always treat it
> as the source of truth.

---

## Conventions

### Request & response format

- Requests and responses use **JSON** (`Content-Type: application/json`).
- Timestamps are ISO 8601. IDs are UUIDs.

### Pagination

List endpoints support offset pagination:

| Parameter | Default | Max |
| --- | --- | --- |
| `limit` | `50` | `500` |
| `offset` | `0` | — |

```bash
curl "https://your-domain.com/api/v2/contacts?limit=100&offset=200" \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

### Errors

Errors return an appropriate HTTP status with a JSON body describing the problem. Common statuses:

| Status | Meaning |
| --- | --- |
| `400` | Validation error — check the message/details. |
| `401` | Not authenticated (or auth method not accepted). |
| `403` | Authenticated but not permitted (RBAC / plan / module gating). |
| `404` | Resource not found (or not in your tenant). |
| `409` | Conflict (e.g. duplicate). |
| `422` | Semantically invalid input. |
| `429` | Rate limit exceeded. |
| `5xx` | Server error. |

### Rate limiting

The public API is rate-limited (per the OpenAPI spec, on the order of **100 requests per minute per
user**; specific endpoints such as login, signup, password reset, and AI have their own tighter
limits). When you exceed a limit you receive `429`. Back off and retry.

### Idempotency & safety

- `GET` is safe and cacheable where indicated.
- Prefer server-side validation of your payloads; the API validates input and rejects malformed
  requests with `400`/`422`.

---

## Trying it out

- **Swagger UI** at `/api-docs` lets you authenticate and call endpoints from the browser.
- Import [`openapi.yaml`](../../../public/api/openapi.yaml) into Postman/Insomnia.
- See the repo's `postman/` collection for ready-made requests, and
  [`docs/API-TESTING-GUIDE.md`](../../API-TESTING-GUIDE.md) for testing tips.

---

## Related

- [Authentication](./authentication.md)
- [SDK](./sdk.md) — typed client that wraps these endpoints
- [Webhooks](./webhooks.md) — event push instead of polling
- [`docs/API_MIGRATION_v1_to_v2.md`](../../API_MIGRATION_v1_to_v2.md) — migrating from v1

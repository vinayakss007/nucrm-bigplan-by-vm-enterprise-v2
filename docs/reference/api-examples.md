# API Examples

Copy-paste examples for common NuCRM API operations. These complement the machine-readable
[OpenAPI spec](../../public/api/openapi.yaml) (interactive Swagger UI at `/api-docs`), which remains
the authoritative definition of every field.

> **Base URL:** `https://<your-domain>/api/v2` · **Auth:** `Authorization: Bearer <api_key>`
> (see the Developer → Authentication guide). All bodies are JSON.

---

## Conventions used below

- Replace `<your-domain>` and `$NUCRM_API_KEY` with your values.
- IDs are UUIDs. Timestamps are ISO 8601.
- List endpoints paginate with `limit` (default 50, max 500) and `offset` (default 0).
- Errors return an HTTP status + JSON body; see [Error responses](#error-responses).

---

## Contacts

### List contacts

```bash
curl "https://<your-domain>/api/v2/contacts?limit=25&offset=0" \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

```jsonc
// 200 OK (shape is illustrative — see OpenAPI for exact fields)
{
  "data": [
    {
      "id": "3f1c…",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "companyId": "9a2b…",
      "tags": ["vip"],
      "createdAt": "2026-08-30T10:00:00Z"
    }
  ],
  "pagination": { "limit": 25, "offset": 0, "total": 1 }
}
```

### Create a contact

```bash
curl -X POST "https://<your-domain>/api/v2/contacts" \
  -H "Authorization: Bearer $NUCRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Ada Lovelace", "email": "ada@example.com" }'
```

### Get / update / delete one

```bash
curl "https://<your-domain>/api/v2/contacts/<id>" -H "Authorization: Bearer $NUCRM_API_KEY"

curl -X PATCH "https://<your-domain>/api/v2/contacts/<id>" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "tags": ["vip", "newsletter"] }'

curl -X DELETE "https://<your-domain>/api/v2/contacts/<id>" \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

### Merge duplicates

```bash
curl -X POST "https://<your-domain>/api/v2/contacts/merge" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "primaryId": "<keep-id>", "mergeId": "<absorb-id>" }'
```

---

## Deals

### Create a deal

```bash
curl -X POST "https://<your-domain>/api/v2/deals" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "title": "Acme — Annual Plan",
    "value": 12000,
    "currency": "USD",
    "stage": "qualification",
    "contactId": "3f1c…"
  }'
```

### Move a deal to another stage

```bash
curl -X PATCH "https://<your-domain>/api/v2/deals/<id>" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "stage": "negotiation" }'
```

---

## Leads

### Create a lead

```bash
curl -X POST "https://<your-domain>/api/v2/leads" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "name": "Grace Hopper", "email": "grace@example.com", "source": "website" }'
```

### Convert a lead

```bash
curl -X POST "https://<your-domain>/api/v2/leads/<id>/convert" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "createDeal": true, "createCompany": true }'
```

---

## Tasks

```bash
# Create
curl -X POST "https://<your-domain>/api/v2/tasks" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "title": "Follow up with Acme", "dueDate": "2026-09-05", "priority": "high", "relatedId": "…" }'

# List open, high-priority tasks
curl "https://<your-domain>/api/v2/tasks?priority=high&status=open" \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

---

## Invoices

```bash
# Create an invoice with line items
curl -X POST "https://<your-domain>/api/v2/invoices" \
  -H "Authorization: Bearer $NUCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "contactId": "3f1c…",
    "lineItems": [
      { "productId": "…", "quantity": 2, "unitPrice": 500 }
    ],
    "currency": "USD",
    "dueDate": "2026-09-30"
  }'
```

---

## Forms (lead capture)

```bash
# Public submission — no auth; creates a lead/contact and fires automations
curl -X POST "https://<your-domain>/api/forms/submit" \
  -H "Content-Type: application/json" \
  -d '{ "formId": "<form-id>", "data": { "email": "lead@example.com", "name": "New Lead" } }'
```

---

## Pagination pattern

```bash
# Page through all contacts in batches of 200
offset=0
while : ; do
  resp=$(curl -s "https://<your-domain>/api/v2/contacts?limit=200&offset=$offset" \
    -H "Authorization: Bearer $NUCRM_API_KEY")
  count=$(echo "$resp" | jq '.data | length')
  echo "$resp" | jq -c '.data[]'
  [ "$count" -lt 200 ] && break
  offset=$((offset + 200))
done
```

---

## Error responses

```jsonc
// 400 — validation error
{ "error": { "code": "validation_error", "message": "…", "details": [ … ] } }
```

| Status | Meaning | What to do |
| --- | --- | --- |
| `400` / `422` | Invalid input | Fix the payload per the message/details. |
| `401` | Not authenticated | Check your API key / token. |
| `403` | Not permitted | RBAC, plan, or module gating — check the caller's role/plan. |
| `404` | Not found (or not in your tenant) | Verify the ID and tenant. |
| `409` | Conflict (e.g. duplicate) | Reconcile and retry. |
| `429` | Rate limited (~100/min per user) | Back off and retry with jitter. |
| `5xx` | Server error | Retry with backoff; if persistent, check platform health. |

---

## Related

- OpenAPI spec: [`public/api/openapi.yaml`](../../public/api/openapi.yaml) · Swagger UI: `/api-docs`
- Developer API reference: [`docs/public/developer/`](../public/developer/README.md)
- Postman collection: [`postman/`](../../postman)

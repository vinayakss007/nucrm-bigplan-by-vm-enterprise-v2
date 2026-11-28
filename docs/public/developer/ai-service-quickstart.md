# Build an AI service that reads NuCRM documents

This quickstart shows the smallest reliable setup for an external service — for example a
summariser, search indexer, or document-aware agent — that reads a tenant's stored documents
from NuCRM and writes results back.

> **Principle:** your service owns its own database and model calls. NuCRM stays the source of
> truth for CRM data. Connect over the documented REST API with a tenant-scoped API key; do not
> read NuCRM tables directly.

---

## 1. Create an API key

A workspace admin generates a key under **Settings → API keys**. Give it only the scopes the
service needs:

| Task                                   | Scope                                          |
| -------------------------------------- | ---------------------------------------------- |
| List documents                         | `documents.view`                               |
| Read one document + signed URL         | `documents.view`                               |
| Create tasks / follow-ups from results | `tasks.create` (or the equivalent write scope) |

Keys are `ak_live_…`, are hashed at rest, belong to exactly one tenant, and can be revoked or
expired at any time. A key never inherits super-admin rights. Store it in your service's secret
manager, never in source control.

---

## 2. Read the document catalog

Use `/api/tenant`, not `/api/v2` (v2 is a deprecated redirect).

```bash
curl "https://<your-domain>/api/tenant/documents?page=1&limit=50" \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

Response shape:

```json
{
  "data": {
    "documents": [
      {
        "id": "…uuid…",
        "name": "proposal.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 184320,
        "entityType": "deal",
        "entityId": "…uuid…",
        "createdAt": "2026-11-28T10:00:00.000Z"
      }
    ],
    "folders": []
  },
  "page": 1,
  "limit": 50,
  "total": 1
}
```

Filters: `entityType`, `entityId`, `folderId`, `page`, `limit` (max 200). Soft-deleted documents
are excluded.

---

## 3. Get the file bytes

```bash
curl "https://<your-domain>/api/tenant/documents/<document-id>" \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

The `data.download_url` field is a **signed S3 URL valid for 10 minutes**. Fetch the bytes from
that URL with a plain `GET` (no auth header). Treat it as short-lived: do not persist it, refresh
it by calling the endpoint again.

```ts
const meta = await fetch(`${base}/api/tenant/documents/${id}`, {
  headers: { Authorization: `Bearer ${apiKey}` },
}).then((r) => r.json());
const bytes = await fetch(meta.data.download_url).then((r) => r.arrayBuffer());
```

If storage is misconfigured the endpoint returns `502` — alert on it rather than retrying in a
tight loop.

---

## 4. Optional: use the typed SDK

The SDK lives in this repository at `lib/sdk`. It targets `/api/tenant` directly — pass your
instance origin as `baseUrl`, **without** an API path suffix.

```ts
import { NuCRMClient } from "./lib/sdk";

const crm = new NuCRMClient({
  baseUrl: process.env.NUCRM_URL!, // https://your-domain.com
  apiKey: process.env.NUCRM_API_KEY!, // ak_live_…
});

const page = await crm.documents.list({ entityType: "deal", limit: 50 });
for (const doc of page.data.documents) {
  const detail = await crm.documents.get(doc.id);
  const bytes = await fetch(detail.download_url).then((r) => r.arrayBuffer());
  // send bytes to your model / indexer
}
```

`documents.get()` and `documents.create()` unwrap the single-entity `{ data }` envelope;
`documents.list()` keeps the pagination envelope. Do not assume other SDK resources unwrap —
see [`docs/api-envelope-state.md`](../../api-envelope-state.md).

---

## 5. React to new documents instead of polling

Configure an **outbound webhook** under Settings → Webhooks pointing at your service. Verify
the signature before trusting a payload (`WebhookVerifier` in `lib/sdk/webhooks.ts`), respond
`2xx` quickly, and do the document read/analysis asynchronously. Failed deliveries are retried
and land in a dead-letter queue.

---

## 6. Write results back (optional)

With a write scope, create a task or activity from your result:

```ts
await crm.tasks.create({
  subject: `AI summary: ${doc.name}`,
  // ...fields accepted by POST /api/tenant/tasks
});
```

Keep writes idempotent (use a stable key in the title or your own mapping table) so webhook
retries cannot create duplicates.

---

## Operational rules

- **Rate limits:** roughly 100 requests/minute; back off on `429`.
- **Errors:** `401` bad/revoked key, `403` missing scope or permission, `404` not in tenant,
  `429` rate limited, `502` storage signing failure.
- **Tenant isolation:** one key = one tenant. Never accept a tenant id from your own callers and
  forward it to NuCRM; that is a cross-tenant data-leak path.
- **Secrets:** the signed download URL is a capability credential — keep it out of logs.

---

## Related

- [Authentication](./authentication.md)
- [REST API Reference](./rest-api.md) and the [OpenAPI spec](../../../public/api/openapi.yaml)
- [Webhooks](./webhooks.md)
- [SDK](./sdk.md)
- [Read-only MCP server](../../../examples/mcp-documents/README.md) — expose these reads to an agent

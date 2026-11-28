# TypeScript SDK

NuCRM ships an official **TypeScript SDK** that wraps the REST API with typed resource clients,
webhook verification, realtime, and more. It lives in [`lib/sdk`](../../../lib/sdk).

---

## Client

Create a client with your base URL and credentials:

```ts
import { NuCRMClient } from "./lib/sdk"; // in-repo SDK; not published as @nucrm/sdk

const nucrm = new NuCRMClient({
  baseUrl: "https://your-domain.com", // instance origin — the SDK appends /api/tenant
  apiKey: process.env.NUCRM_API_KEY!,
});
```

Errors are thrown as `NuCRMError` with useful status/detail information.

---

## Resource clients

The SDK provides typed clients for the core resources:

- `contacts`, `companies`, `leads`, `deals`, `tasks`, `activities`, `meetings`
- `tickets`, `documents`
- `invoices`, `quotes`, `orders`, `contracts`, `subscriptions`, `services`
- `forms`, `sequences`, `automations`, `reports`

```ts
// Create a contact
const contact = await nucrm.contacts.create({
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
});

// List deals with pagination — list() returns { data, total, page, limit }
const deals = await nucrm.deals.list({ limit: 50, page: 1 });
const first = deals.data[0];

// Update, then delete
if (first) await nucrm.deals.update(first.id, { stage: "negotiation" });
await nucrm.tasks.delete(taskId);
```

> **Response envelopes:** `get()`, `create()` and `update()` are currently unwrapped only for
> `documents`; other resources still return the raw route body (often `{ data: entity }`).
> `list()` keeps its pagination envelope everywhere. See
> [`docs/api-envelope-state.md`](../../api-envelope-state.md) before relying on a resource's shape.

---

## Reading documents

`documents` is the resource to use for files stored in the CRM (the `storage_documents` catalog),
as opposed to `files` which handles legacy attachments.

```ts
// Catalog page: { data: { documents, folders }, page, limit, total }
const page = await nucrm.documents.list({
  entityType: "deal",
  entityId: dealId,
  limit: 50,
});

// Detail: unwrapped DocumentDetail with a 10-minute signed download_url
const doc = await nucrm.documents.get(page.data.documents[0]!.id);
const bytes = await fetch(doc.download_url).then((r) => r.arrayBuffer());
```

Requires a key with the `documents.view` scope. See the
[AI service quickstart](./ai-service-quickstart.md) for a complete external-service walkthrough,
and the [read-only MCP server](../../../examples/mcp-documents/README.md) for an agent-facing
wrapper over these tools.

---

## Additional SDK modules

| Module                                  | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| **`WebhookVerifier` / `WebhookRouter`** | Verify inbound webhook signatures and route events. See [Webhooks](./webhooks.md).      |
| **`RealtimeSDK`**                       | Subscribe to realtime events (backed by the socket.io realtime service).                |
| **`FileSDK`**                           | Upload and manage file attachments.                                                     |
| **`SearchSDK`**                         | Cross-resource search.                                                                  |
| **`BulkOperations`**                    | Batch create/update/delete.                                                             |
| **`AuthSDK`**                           | Authentication flows.                                                                   |
| **`BillingSDK`**                        | Billing/subscription operations.                                                        |
| **`TemplateSDK`**                       | Work with templates.                                                                    |
| **`defineModule`**                      | Author a NuCRM **module** (a pluggable mini-app) with pages, settings, and permissions. |

---

## Building modules

The SDK's `defineModule` helper (with `ModuleManifest`, `ModulePage`, `SettingField` types) lets
you build self-contained modules that plug into the CRM — declaring their own pages, settings UI,
and permissions. This is the extension model behind NuCRM's module system.

```ts
import { defineModule } from "../../../lib/sdk";

export default defineModule({
  name: "my-module",
  pages: [/* ... */],
  settings: [/* ... */],
});
```

---

## Related

- [REST API Reference](./rest-api.md) — the endpoints the SDK calls
- [Authentication](./authentication.md) — credentials the client uses
- [Webhooks](./webhooks.md) — receive events

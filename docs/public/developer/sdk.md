# TypeScript SDK

NuCRM ships an official **TypeScript SDK** that wraps the REST API with typed resource clients,
webhook verification, realtime, and more. It lives in [`lib/sdk`](../../../lib/sdk).

---

## Client

Create a client with your base URL and credentials:

```ts
import { NuCRMClient } from '@nucrm/sdk';

const nucrm = new NuCRMClient({
  baseUrl: 'https://your-domain.com/api/v2',
  apiKey: process.env.NUCRM_API_KEY, // or a session/JWT depending on context
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
  name: 'Ada Lovelace',
  email: 'ada@example.com',
});

// List deals with pagination
const deals = await nucrm.deals.list({ limit: 50, offset: 0 });

// Update, then delete
await nucrm.deals.update(deals[0].id, { stage: 'negotiation' });
await nucrm.tasks.delete(taskId);
```

---

## Additional SDK modules

| Module | Purpose |
| --- | --- |
| **`WebhookVerifier` / `WebhookRouter`** | Verify inbound webhook signatures and route events. See [Webhooks](./webhooks.md). |
| **`RealtimeSDK`** | Subscribe to realtime events (backed by the socket.io realtime service). |
| **`FileSDK`** | Upload and manage file attachments. |
| **`SearchSDK`** | Cross-resource search. |
| **`BulkOperations`** | Batch create/update/delete. |
| **`AuthSDK`** | Authentication flows. |
| **`BillingSDK`** | Billing/subscription operations. |
| **`TemplateSDK`** | Work with templates. |
| **`defineModule`** | Author a NuCRM **module** (a pluggable mini-app) with pages, settings, and permissions. |

---

## Building modules

The SDK's `defineModule` helper (with `ModuleManifest`, `ModulePage`, `SettingField` types) lets
you build self-contained modules that plug into the CRM — declaring their own pages, settings UI,
and permissions. This is the extension model behind NuCRM's module system.

```ts
import { defineModule } from '@nucrm/sdk';

export default defineModule({
  name: 'my-module',
  pages: [/* ... */],
  settings: [/* ... */],
});
```

---

## Related

- [REST API Reference](./rest-api.md) — the endpoints the SDK calls
- [Authentication](./authentication.md) — credentials the client uses
- [Webhooks](./webhooks.md) — receive events

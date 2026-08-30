# Developer & API Reference — Overview

Integrate with NuCRM programmatically: read and write CRM data, receive events, and embed forms.

> **Audience:** engineers building integrations or automations.

---

## What's available

| Capability | Doc |
| --- | --- |
| **REST API** | [REST API Reference](./rest-api.md) |
| **Authentication** (API keys, JWT, tenant resolution) | [Authentication](./authentication.md) |
| **Official TypeScript SDK** | [SDK](./sdk.md) |
| **Webhooks** (outbound events) | [Webhooks](./webhooks.md) |
| **Embeddable forms & lead capture** | [Embeds & Forms](./embeds-and-forms.md) |

---

## API versions & base URLs

NuCRM exposes a **versioned public API**. The current version is **v2**.

| Version | Base path | Notes |
| --- | --- | --- |
| **v2** | `/api/v2` | Current. Recommended for all new integrations. |
| **v1** | `/api/v1` | Maintained for compatibility. See the v1→v2 migration notes. |

Example base URLs:

- Local development: `http://localhost:3000/api/v2`
- Your production instance: `https://<your-domain>/api/v2`

Both `v1` and `v2` are **gateways**: they authenticate the request, resolve the target
**tenant**, apply CORS, and route to the underlying CRM resource. This means you get a stable,
versioned surface even as internals evolve.

---

## Interactive & machine-readable specs

- **OpenAPI spec:** [`public/api/openapi.yaml`](../../../public/api/openapi.yaml) (OpenAPI 3.1) —
  import it into Postman, Insomnia, or code generators.
- **Swagger UI:** available at **`/api-docs`** on a running instance for interactive exploration.

---

## Quick example

```bash
# List contacts (Bearer token / API key)
curl https://your-domain.com/api/v2/contacts \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

```ts
// Using the TypeScript SDK
import { NuCRMClient } from '@nucrm/sdk';

const nucrm = new NuCRMClient({
  baseUrl: 'https://your-domain.com/api/v2',
  apiKey: process.env.NUCRM_API_KEY,
});

const contacts = await nucrm.contacts.list({ limit: 50 });
```

---

## Conventions

- **JSON** request and response bodies.
- **Authentication** on every non-public endpoint — see [Authentication](./authentication.md).
- **Tenant scoping** — requests act within one workspace (tenant), resolved from your credentials.
- **Pagination**, **errors**, and **rate limits** follow consistent rules documented in the
  [REST API Reference](./rest-api.md).

---

## Related

- [Workspace Admin → Integrations](../admin-guide/integrations.md) — generate API keys, connect tools
- [Webhooks](./webhooks.md) — get pushed events instead of polling

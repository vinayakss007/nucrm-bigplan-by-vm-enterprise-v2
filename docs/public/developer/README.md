# Developer & API Reference — Overview

Integrate with NuCRM programmatically: read and write CRM data, receive events, and embed forms.

> **Audience:** engineers building integrations or automations.

---

## What's available

| Capability                                            | Doc                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| **REST API**                                          | [REST API Reference](./rest-api.md)                                   |
| **Authentication** (API keys, JWT, tenant resolution) | [Authentication](./authentication.md)                                 |
| **Official TypeScript SDK**                           | [SDK](./sdk.md)                                                       |
| **Build an AI service that reads documents**          | [AI service quickstart](./ai-service-quickstart.md)                   |
| **Webhooks** (outbound events)                        | [Webhooks](./webhooks.md)                                             |
| **Embeddable forms & lead capture**                   | [Embeds & Forms](./embeds-and-forms.md)                               |
| **Read-only MCP server for documents**                | [`examples/mcp-documents`](../../../examples/mcp-documents/README.md) |

---

## API base URLs

New integrations should call the tenant API directly:

- Local development: `http://localhost:3000/api/tenant`
- Your production instance: `https://<your-domain>/api/tenant`

`/api/v1` and `/api/v2` remain as **deprecated compatibility gateways** that resolve the tenant
and redirect to `/api/tenant` (with Sunset headers). They still work but are not where new
endpoints are added. The SDK targets `/api/tenant` itself — pass your instance origin as
`baseUrl`, without any API path suffix.

API keys (`Authorization: Bearer ak_live_…`) are accepted on `/api/tenant` data routes; cookies
and JWTs work there too.

---

## Interactive & machine-readable specs

- **OpenAPI spec:** [`public/api/openapi.yaml`](../../../public/api/openapi.yaml) (OpenAPI 3.1) —
  import it into Postman, Insomnia, or code generators.
- **Swagger UI:** available at **`/api-docs`** on a running instance for interactive exploration.

---

## Quick example

```bash
# List contacts (Bearer token / API key)
curl https://your-domain.com/api/tenant/contacts \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

```ts
// Using the TypeScript SDK
import { NuCRMClient } from "@nucrm/sdk";

const nucrm = new NuCRMClient({
  baseUrl: "https://your-domain.com",
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

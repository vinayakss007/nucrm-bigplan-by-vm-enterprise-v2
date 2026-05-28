# Architecture: Modules vs Integrations vs Plugins

NuCRM uses a three-tier extensibility model. Each tier serves a different purpose and audience.

---

## Overview

| Aspect            | Modules                          | Integrations                      | Plugins                            |
| ----------------- | -------------------------------- | --------------------------------- | ---------------------------------- |
| **What**          | Internal feature packs           | First-party curated providers     | User-created custom connectors     |
| **Built by**      | NuCRM team                       | NuCRM team                        | End users (tenants)                |
| **Gating**        | Plan-gated (Free/Pro/Enterprise) | Plan-gated + provider credentials | Always available (any plan)        |
| **Location**      | `lib/modules/`                   | `lib/integrations/`               | `lib/plugins/`                     |
| **Schema**        | `drizzle/schema/modules.ts`      | `drizzle/schema/comm.ts`          | `drizzle/schema/plugins.ts`        |
| **API routes**    | Various `/api/tenant/*`          | `/api/tenant/integrations/`       | `/api/tenant/plugins/`             |
| **UI**            | Various `/tenant/*` pages        | `/tenant/integrations`            | `/tenant/plugins`                  |
| **Config stored** | Feature flags in plans table     | Integration credentials table     | `custom_plugins` table             |
| **Execution**     | Native application code          | Provider SDK / HTTP calls         | Generic HTTP engine with auth      |

---

## Modules (`lib/modules/`)

Modules are internal feature packs built and maintained by the NuCRM team. They represent core CRM functionality that is gated by the tenant's subscription plan.

Examples:
- Pipeline management
- Contact management
- Activity tracking
- Reporting and analytics
- Workflow automation

Modules are not user-configurable beyond plan-level on/off. They integrate deeply with the database schema and application logic.

### Key files

- `lib/modules/` - Module business logic
- `drizzle/schema/modules.ts` - Module-related database tables
- Plan gating configured in the `plans` table

---

## Integrations (`lib/integrations/`)

Integrations are first-party connections to well-known external services. They are curated, tested, and maintained by the NuCRM team with provider-specific logic.

Supported providers:
- **SendGrid** - Transactional email
- **Mailgun** - Email delivery
- **Slack** - Team notifications
- **OpenAI** - AI-powered features
- **Twilio** - SMS and voice

### Key files

- `lib/integrations/types.ts` - `ProviderDefinition` interface and related types
- `lib/integrations/registry.ts` - Provider registry with all available integrations
- `lib/integrations/providers/` - Individual provider implementations (e.g., `sendgrid.ts`)
- `lib/integrations/ai-connector.ts` - AI provider abstraction layer
- `drizzle/schema/comm.ts` - Integration credentials and configuration tables
- `app/api/tenant/integrations/route.ts` - Integration CRUD API
- `app/api/tenant/plugin-engine/route.ts` - Integration execution engine (legacy naming)
- `app/tenant/integrations/page.tsx` - Integration management UI

### How it works

1. Admin enables an integration and provides credentials (API keys, tokens)
2. Credentials are stored encrypted in the database
3. Application code calls provider-specific methods through the registry
4. Each provider has a typed definition with supported actions and configuration schema

---

## Plugins (`lib/plugins/`)

Plugins are user-created custom connectors. Any tenant can create a plugin to connect to any HTTP API, with no involvement from the NuCRM team.

### Key files

- `lib/plugins/types.ts` - Plugin type definitions (PluginDefinition, PluginAction, PluginAuthConfig, etc.)
- `lib/plugins/engine.ts` - Generic HTTP execution engine
- `lib/plugins/webhook-handler.ts` - Inbound webhook processing with HMAC verification
- `lib/plugins/crypto.ts` - AES-256-GCM encryption for stored credentials
- `drizzle/schema/plugins.ts` - `custom_plugins` and `plugin_execution_logs` tables
- `app/api/tenant/plugins/` - Full CRUD + execute + webhook API routes
- `app/tenant/plugins/page.tsx` - Plugin management UI with create wizard

### How it works

1. User creates a plugin via the UI wizard:
   - Sets base URL and authentication method
   - Defines one or more actions (HTTP method, path template, body template)
   - Optionally configures a webhook secret for inbound calls
2. Credentials are encrypted with AES-256-GCM before storage
3. When executing an action:
   - Engine resolves authentication (builds headers/query params)
   - Interpolates `{{variables}}` in path and body templates
   - Makes the HTTP call with a 10-second timeout
   - Logs execution result to `plugin_execution_logs`
4. For inbound webhooks:
   - External service POSTs to `/api/tenant/plugins/webhook/[id]/`
   - Signature is verified using HMAC-SHA256 (if secret configured)
   - Rate limited to 60 requests/minute per plugin
   - Payload is logged and can trigger downstream actions

### Auth types supported

| Type                         | How it works                                         |
| ---------------------------- | ---------------------------------------------------- |
| `bearer`                     | Adds `Authorization: Bearer <token>` header          |
| `basic`                      | Adds `Authorization: Basic <base64(user:pass)>` header |
| `api_key_header`             | Adds custom header with API key value                |
| `api_key_query`              | Appends API key as URL query parameter               |
| `oauth2_client_credentials`  | Fetches access token from token URL, then uses it    |
| `none`                       | No authentication applied                            |

---

## When to use which

- **Need a new CRM feature?** Build it as a Module (requires code change, plan gating).
- **Want to add a well-known provider (e.g., HubSpot)?** Add it as an Integration with a typed provider definition.
- **User wants to connect their own API?** They create a Plugin through the UI - no code changes needed.

---

## Directory structure summary

```
lib/
  modules/           # Internal feature packs (plan-gated)
  integrations/      # First-party curated providers
    types.ts
    registry.ts
    providers/
      sendgrid.ts
      ...
    ai-connector.ts
  plugins/           # User-created custom connectors
    types.ts
    engine.ts
    webhook-handler.ts
    crypto.ts

drizzle/schema/
  modules.ts         # Module-related tables
  comm.ts            # Integration/communication tables
  plugins.ts         # Plugin system tables

app/api/tenant/
  integrations/      # Integration API routes
  plugins/           # Plugin API routes
  plugin-engine/     # Integration execution (legacy naming)

app/tenant/
  integrations/      # Integration management UI
  plugins/           # Plugin management UI
```

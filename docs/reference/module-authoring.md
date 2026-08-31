# Module Authoring Guide

NuCRM modules are **self-contained mini-apps** that plug into the CRM: they can add pages, API
routes, database tables, permissions, a settings UI, and plan-based pricing. This guide shows how to
author one with the Module SDK.

> **Source of truth:** the SDK types live in
> [`lib/modules/sdk/types.ts`](../../lib/modules/sdk/types.ts) and are re-exported from
> [`lib/sdk`](../../lib/sdk). The registry/loader lives in [`lib/modules`](../../lib/modules).

---

## What a module provides

Each module is declared with a **manifest** and can contribute:

- **Pages** — routes and sidebar navigation entries.
- **API routes** — its own backend endpoints.
- **Database tables** — via its own migrations.
- **Permissions** — auto-created in RBAC.
- **Settings UI** — a schema that renders a config form.
- **Pricing** — which plans the module is available on, and at what price.
- **Webhooks** and **dependencies** on other modules.

---

## `defineModule`

```ts
import { defineModule } from "@/lib/modules/sdk/types";

export default defineModule({
  id: "whatsapp-automation", // unique module id
  name: "WhatsApp Automation",
  version: "1.0.0", // semantic version
  description: "Send WhatsApp messages, auto-replies, campaigns",
  author: "Your Company",
  category: "messaging", // utility | automation | messaging | integration | ai | analytics
  icon: "💬", // emoji or icon name
  minCrmVersion: "0.8.1", // optional

  pricing: {
    // per-plan availability & price
    free: { enabled: false },
    starter: { enabled: true, price: 19 },
    pro: { enabled: true, price: 19 },
    enterprise: { enabled: true, price: 0 },
  },

  features: [
    "WhatsApp Business API",
    "Template messages",
    "Auto-replies",
    "Bulk campaigns",
  ],

  permissions: ["whatsapp.view", "whatsapp.send", "whatsapp.templates"],

  pages: [
    { path: "/tenant/whatsapp", label: "WhatsApp", icon: "MessageSquare" },
    {
      path: "/tenant/whatsapp/templates",
      label: "Templates",
      icon: "FileText",
    },
  ],

  migrations: "./my-whatsapp-module/migrations",

  settings_schema: [
    {
      key: "phone_number_id",
      label: "Phone Number ID",
      type: "text",
      required: true,
    },
    {
      key: "access_token",
      label: "Access Token",
      type: "password",
      required: true,
    },
  ],

  webhooks: ["whatsapp.message_received"],
  dependsOn: ["core-crm"],
});
```

---

## Manifest fields

| Field             | Type                                | Notes                                                                   |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `id`              | `string`                            | Unique module id.                                                       |
| `name`            | `string`                            | Display name.                                                           |
| `version`         | `string`                            | Semantic version.                                                       |
| `description`     | `string`                            | Short description.                                                      |
| `author`          | `string?`                           | Vendor/author name.                                                     |
| `category`        | enum                                | `utility \| automation \| messaging \| integration \| ai \| analytics`. |
| `icon`            | `string`                            | Emoji or icon name.                                                     |
| `minCrmVersion`   | `string?`                           | Minimum CRM version required.                                           |
| `pricing`         | `Record<plan, { enabled; price? }>` | Availability + price per plan.                                          |
| `features`        | `string[]`                          | Marketplace feature list.                                               |
| `permissions`     | `string[]?`                         | Auto-created RBAC permissions.                                          |
| `pages`           | `ModulePage[]?`                     | `{ path, label, icon }` navigation entries.                             |
| `settings_schema` | `SettingField[]?`                   | Renders the config form (see below).                                    |
| `webhooks`        | `string[]?`                         | Events the module emits/listens to.                                     |
| `migrations`      | `string?`                           | Path to the module's DB migrations.                                     |
| `dependsOn`       | `string[]?`                         | Other modules required.                                                 |

### `SettingField`

```ts
interface SettingField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "boolean" | "number";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[]; // for 'select'
}
```

---

## Authoring workflow

1. **Scaffold** a module folder (e.g. `my-module/`) with an `index.ts` that exports
   `defineModule({...})`.
2. **Model data** — add the module's tables and migrations under its `migrations` path; keep every
   tenant table `tenant_id`-scoped with audit columns and RLS
   ([standards](../admin/contributing-and-operations.md#database-standards)).
3. **Build pages & APIs** following the standard
   [API route pattern](../admin/contributing-and-operations.md#api-route-pattern) (`requireAuth`,
   `requirePerm`, `apiError`). Gate access with the module's declared permissions.
4. **Declare settings** so tenants can configure the module without code.
5. **Set pricing** so the module is gated to the right plans.
6. **Register** the module so the loader picks it up (`lib/modules`), then enable it per tenant from
   the [Super-Admin Console → Modules](../admin/superadmin-console.md#commercial).

---

## Testing a module

- Unit-test the module's `lib` logic (100% coverage target on new `lib` files).
- Add tenant-isolation tests for any new data access.
- Verify plan gating: the module should be unavailable on plans where `enabled: false`.

See [Contributing & Operations → Workflow per fix](../admin/contributing-and-operations.md#4-workflow-per-fix).

---

## Related

- SDK overview: [`docs/public/developer/sdk.md`](../public/developer/sdk.md)
- Architecture → Module & plugin architecture:
  [`docs/admin/architecture.md`](../admin/architecture.md#module--plugin-architecture)
- Plugin engine (no-code external API calls) vs modules:
  [Integrations](../public/admin-guide/integrations.md#plugin-engine--connect-any-api)

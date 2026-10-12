/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Support-category documentation content extracted from docs-client (#2330
 * file-size ratchet): pure data, rendered by the docs viewer.
 */
export const SUPPORT_DOCS: Record<string, { title: string; content: string }> = {
    'support/faq': {
      title: 'FAQ',
      content: `# Frequently Asked Questions

Quick answers to common questions. See the [Glossary](./glossary.md) for terminology.

---

## Accounts & access

**How do I get access to NuCRM?**
Either sign up to create a new workspace, or accept an email invitation from a colleague. See
[Getting Started](./getting-started.md).

**I forgot my password.**
Use *Forgot password* on the login page to receive a reset link by email.

**Why am I asked for a code after my password?**
Your workspace requires **two-factor authentication (2FA)**. Enter the code from your authenticator
app. See [Security Settings](./admin-guide/security-settings.md).

**Can we log in with our company's SSO?**
Yes — NuCRM supports SAML, OpenID Connect, and OAuth 2.0. An admin configures it in
[Security Settings](./admin-guide/security-settings.md).

---

## Using NuCRM

**How do I import my existing data?**
Most modules (contacts, leads) support CSV **import** with column mapping and duplicate detection.
See [Contacts & Companies](./user-guide/contacts-and-companies.md#import--export).

**I deleted something by mistake — can I get it back?**
Yes. Destructive actions show a 10-second **undo** toast, and deleted records go to **Trash** where
you can restore them before auto-cleanup.

**How do I move a deal through my pipeline?**
Drag it between columns on the Kanban board. See
[Deals & Pipelines](./user-guide/deals-and-pipelines.md).

**How do I automate repetitive work?**
Use the visual **workflow builder**, **automation rules**, or **sequences**. See
[Automation & Workflows](./user-guide/automation.md).

---

## Communication

**Which email/SMS/WhatsApp providers are supported?**
Email via Resend or SMTP; SMS/voice via Twilio; WhatsApp via the Meta WhatsApp Business API. An
admin connects these in [Integrations](./admin-guide/integrations.md).

**Why aren't my invites or emails sending?**
Email must be configured. If no email provider is set up, invitations, password resets, and
notifications won't send. Ask your admin to configure a provider.

---

## Billing & plans

**What happens when I hit a plan limit?**
NuCRM warns you as you approach limits and may block the action until you upgrade or free capacity.
See [Billing & Plans](./admin-guide/billing-and-plans.md).

**Which payment methods are accepted?**
Depending on your region, payments are processed via Stripe, Razorpay, or PayU.

---

## AI

**How is AI usage measured?**
Each workspace has **AI credits**. Usage draws down the balance; admins can view usage and set
limits. See [AI Features](./user-guide/ai-features.md).

**Is my data used to train AI models?**
AI features send the record context you provide to a configured provider to fulfill the request.
Follow your organization's data-handling policies; your admin controls provider configuration.

---

## Developers

**Where's the API documentation?**
See the [Developer & API Reference](./developer/README.md), the
[OpenAPI spec](../../public/api/openapi.yaml), or the interactive Swagger UI at \`/api-docs\`.

**Is there an SDK?**
Yes — an official TypeScript SDK. See [SDK](./developer/sdk.md).

**How do I get webhook events?**
Configure outbound webhooks and verify them with the SDK. See [Webhooks](./developer/webhooks.md).

---

## Still stuck?

Contact your workspace administrator, or if you operate the platform, see the
[Super-Admin Docs](../admin/README.md) and [Troubleshooting](../TROUBLESHOOTING.md).
`
    },
    'support/troubleshooting': {
      title: 'Troubleshooting',
      content: `# Frequently Asked Questions

Quick answers to common questions. See the [Glossary](./glossary.md) for terminology.

---

## Accounts & access

**How do I get access to NuCRM?**
Either sign up to create a new workspace, or accept an email invitation from a colleague. See
[Getting Started](./getting-started.md).

**I forgot my password.**
Use *Forgot password* on the login page to receive a reset link by email.

**Why am I asked for a code after my password?**
Your workspace requires **two-factor authentication (2FA)**. Enter the code from your authenticator
app. See [Security Settings](./admin-guide/security-settings.md).

**Can we log in with our company's SSO?**
Yes — NuCRM supports SAML, OpenID Connect, and OAuth 2.0. An admin configures it in
[Security Settings](./admin-guide/security-settings.md).

---

## Using NuCRM

**How do I import my existing data?**
Most modules (contacts, leads) support CSV **import** with column mapping and duplicate detection.
See [Contacts & Companies](./user-guide/contacts-and-companies.md#import--export).

**I deleted something by mistake — can I get it back?**
Yes. Destructive actions show a 10-second **undo** toast, and deleted records go to **Trash** where
you can restore them before auto-cleanup.

**How do I move a deal through my pipeline?**
Drag it between columns on the Kanban board. See
[Deals & Pipelines](./user-guide/deals-and-pipelines.md).

**How do I automate repetitive work?**
Use the visual **workflow builder**, **automation rules**, or **sequences**. See
[Automation & Workflows](./user-guide/automation.md).

---

## Communication

**Which email/SMS/WhatsApp providers are supported?**
Email via Resend or SMTP; SMS/voice via Twilio; WhatsApp via the Meta WhatsApp Business API. An
admin connects these in [Integrations](./admin-guide/integrations.md).

**Why aren't my invites or emails sending?**
Email must be configured. If no email provider is set up, invitations, password resets, and
notifications won't send. Ask your admin to configure a provider.

---

## Billing & plans

**What happens when I hit a plan limit?**
NuCRM warns you as you approach limits and may block the action until you upgrade or free capacity.
See [Billing & Plans](./admin-guide/billing-and-plans.md).

**Which payment methods are accepted?**
Depending on your region, payments are processed via Stripe, Razorpay, or PayU.

---

## AI

**How is AI usage measured?**
Each workspace has **AI credits**. Usage draws down the balance; admins can view usage and set
limits. See [AI Features](./user-guide/ai-features.md).

**Is my data used to train AI models?**
AI features send the record context you provide to a configured provider to fulfill the request.
Follow your organization's data-handling policies; your admin controls provider configuration.

---

## Developers

**Where's the API documentation?**
See the [Developer & API Reference](./developer/README.md), the
[OpenAPI spec](../../public/api/openapi.yaml), or the interactive Swagger UI at \`/api-docs\`.

**Is there an SDK?**
Yes — an official TypeScript SDK. See [SDK](./developer/sdk.md).

**How do I get webhook events?**
Configure outbound webhooks and verify them with the SDK. See [Webhooks](./developer/webhooks.md).

---

## Still stuck?

Contact your workspace administrator, or if you operate the platform, see the
[Super-Admin Docs](../admin/README.md) and [Troubleshooting](../TROUBLESHOOTING.md).
`
    },
    'support/error-codes': {
      title: 'Error Codes',
      content: `# REST API Reference

The NuCRM REST API gives programmatic access to CRM data — contacts, companies, deals, tasks,
invoices, quotes, orders, contracts, and more.

> **Spec:** the authoritative, machine-readable definition is
> [\`public/api/openapi.yaml\`](../../../public/api/openapi.yaml) (OpenAPI 3.1). Explore it
> interactively at **\`/api-docs\`**. This page summarizes conventions.

---

## Base URL & version

\`\`\`
https://<your-domain>/api/v2
\`\`\`

The current API version is **v2**. See [Overview](./README.md#api-versions--base-urls) for v1.

## Authentication

All endpoints (except public/health) require authentication and are scoped to a tenant. See
[Authentication](./authentication.md).

---

## Resources

The API exposes CRUD-style endpoints for the core CRM resources, including:

| Resource | Example endpoints |
| --- | --- |
| **Contacts** | \`GET/POST /contacts\`, \`GET/PUT/DELETE /contacts/{id}\`, \`POST /contacts/merge\`, import/export |
| **Companies** | \`GET/POST /companies\`, \`GET/PUT/DELETE /companies/{id}\` |
| **Leads** | \`GET/POST /leads\`, \`POST /leads/{id}/convert\` |
| **Deals** | \`GET/POST /deals\`, \`GET/PUT/DELETE /deals/{id}\` |
| **Tasks** | \`GET/POST /tasks\`, \`GET/PUT/DELETE /tasks/{id}\` |
| **Meetings / Activities** | \`GET/POST /meetings\`, \`GET/POST /activities\` |
| **Tickets** | \`GET/POST /tickets\` |
| **Invoices / Quotes / Orders** | \`GET/POST /invoices\`, \`/quotes\`, \`/orders\` |
| **Contracts / Subscriptions / Services** | \`GET/POST /contracts\`, \`/subscriptions\`, \`/services\` |
| **Products** | \`GET/POST /products\` |
| **Forms / Sequences / Automations / Reports** | \`GET/POST /forms\`, \`/sequences\`, \`/automations\`, \`/reports\` |

> The exact list of paths, parameters, and schemas is defined in the OpenAPI spec — always treat it
> as the source of truth.

---

## Conventions

### Request & response format

- Requests and responses use **JSON** (\`Content-Type: application/json\`).
- Timestamps are ISO 8601. IDs are UUIDs.

### Pagination

List endpoints support offset pagination:

| Parameter | Default | Max |
| --- | --- | --- |
| \`limit\` | \`50\` | \`500\` |
| \`offset\` | \`0\` | — |

\`\`\`bash
curl "https://your-domain.com/api/v2/contacts?limit=100&offset=200" \
  -H "Authorization: Bearer \$NUCRM_API_KEY"
\`\`\`

### Errors

Errors return an appropriate HTTP status with a JSON body describing the problem. Common statuses:

| Status | Meaning |
| --- | --- |
| \`400\` | Validation error — check the message/details. |
| \`401\` | Not authenticated (or auth method not accepted). |
| \`403\` | Authenticated but not permitted (RBAC / plan / module gating). |
| \`404\` | Resource not found (or not in your tenant). |
| \`409\` | Conflict (e.g. duplicate). |
| \`422\` | Semantically invalid input. |
| \`429\` | Rate limit exceeded. |
| \`5xx\` | Server error. |

### Rate limiting

The public API is rate-limited (per the OpenAPI spec, on the order of **100 requests per minute per
user**; specific endpoints such as login, signup, password reset, and AI have their own tighter
limits). When you exceed a limit you receive \`429\`. Back off and retry.

### Idempotency & safety

- \`GET\` is safe and cacheable where indicated.
- Prefer server-side validation of your payloads; the API validates input and rejects malformed
  requests with \`400\`/\`422\`.

---

## Trying it out

- **Swagger UI** at \`/api-docs\` lets you authenticate and call endpoints from the browser.
- Import [\`openapi.yaml\`](../../../public/api/openapi.yaml) into Postman/Insomnia.
- See the repo's \`postman/\` collection for ready-made requests, and
  [\`docs/API-TESTING-GUIDE.md\`](../../API-TESTING-GUIDE.md) for testing tips.

---

## Related

- [Authentication](./authentication.md)
- [SDK](./sdk.md) — typed client that wraps these endpoints
- [Webhooks](./webhooks.md) — event push instead of polling
- [\`docs/API_MIGRATION_v1_to_v2.md\`](../../API_MIGRATION_v1_to_v2.md) — migrating from v1
`
    },
    'support/contact': {
      title: 'Contact Support',
      content: `# Customer Portal Guide

The **Customer Portal** is the self-service area your customers use — separate from the main CRM
that your team uses. It's branded to your business.

> **Audience:** the customers of a NuCRM workspace (and the admins who enable it).

---

## What customers can do

| Feature | Description |
| --- | --- |
| **Support tickets** | Create tickets, track status, and reply — without needing a CRM account. |
| **Knowledge base** | Browse and search your published help articles for self-service answers. |
| **Invoices** | View and download their invoices. |

---

## Signing in

Customers access the portal at your workspace's portal URL (optionally on your **custom domain**).
Depending on configuration, they either log in as a **portal client** or use secure links sent to
them (for example, to view a specific invoice or offer).

---

## Tickets in the portal

- Customers submit a new request; it becomes a **ticket** in your workspace.
- They can follow the ticket's status and add replies.
- Your team's internal notes are never visible to customers.

See the agent-side view in [Support & Knowledge Base](./user-guide/support-and-kb.md).

---

## Knowledge base in the portal

Articles your team **publishes** appear in the portal, organized by category and fully searchable —
helping customers solve problems on their own and reducing ticket volume.

---

## Invoices & offers

- **Invoices** — customers can view and download invoices addressed to them.
- **Offers** — customers can open a shared **offer link** to review and **accept or decline** a
  proposal without logging in. Their response is recorded in your CRM. See
  [Sales Documents → Offers](./user-guide/sales-documents.md#offers).

---

## Branding

The portal reflects **your** branding — logo, colors, and domain — configured by your workspace
admin in [Branding & Customization](./admin-guide/branding-and-customization.md).

---

## Related

- [Support & Knowledge Base](./user-guide/support-and-kb.md) — the team side of the portal
- [Sales Documents](./user-guide/sales-documents.md) — invoices and offers customers see
`
    },
};

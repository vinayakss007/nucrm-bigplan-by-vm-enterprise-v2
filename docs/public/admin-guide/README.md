# Workspace Admin Guide — Overview

For **workspace owners and administrators** who configure NuCRM for their team. This is *tenant*
administration — it does not cover operating the platform itself (that's the
[Super-Admin Docs](../../admin/README.md)).

> 👤 **Tenant admin** — most actions here require an admin or owner role in your workspace.

---

## What a workspace admin does

| Responsibility | Guide |
| --- | --- |
| Add people and control what they can do | [Team & Roles](./team-and-roles.md) |
| Manage the subscription, plan, and invoices | [Billing & Plans](./billing-and-plans.md) |
| Make NuCRM look and behave like your business | [Branding & Customization](./branding-and-customization.md) |
| Connect email, messaging, calendar, and other tools | [Integrations](./integrations.md) |
| Enforce security and access policies | [Security Settings](./security-settings.md) |

---

## The Settings area

Almost all admin configuration lives under **Settings**. Common sections include:

- **General** — workspace name, defaults, localization
- **Profile & Preferences** — per-user settings
- **Team, Roles, Permissions** — access control
- **Pipelines, Custom fields, Tags, Picklists** — data model customization
- **Email, SMS, Webhooks, Integrations, Plugins, API keys** — connectivity
- **Branding** — logo, colors, custom domain, portal branding
- **Billing** — plan and payment
- **Security, SSO, Login policy, Sessions, IP allowlist** — protection
- **Backup, Audit, Compliance** — governance
- **Tax, Currency** — financial configuration
- **SLA, Territories, Hierarchy** — operations
- **Import/Export** — data movement

---

## Recommended setup order

1. **Branding & data model** — set your logo/colors, pipelines, and custom fields so records match
   your business. → [Branding & Customization](./branding-and-customization.md)
2. **Team & roles** — invite people and assign roles. → [Team & Roles](./team-and-roles.md)
3. **Integrations** — connect email first (needed for invites and notifications), then messaging
   and calendar. → [Integrations](./integrations.md)
4. **Security** — enforce 2FA/SSO and set login policy. → [Security Settings](./security-settings.md)
5. **Billing** — confirm your plan and payment method. → [Billing & Plans](./billing-and-plans.md)

---

## Related

- [User Guide](../user-guide/README.md) — how the features you're configuring are used
- [Developer & API Reference](../developer/README.md) — API keys and programmatic access

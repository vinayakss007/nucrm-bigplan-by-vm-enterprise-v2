# Data Model Reference

A domain-grouped map of the NuCRM database. The schema is defined with **Drizzle ORM** in
[`drizzle/schema/`](../../drizzle) — that code is the source of truth for exact columns, types, and
relations. This page is the orientation layer on top of it.

> **Scale:** ~223 table definitions across 42 schema files. Every tenant-scoped table carries a
> `tenant_id` and audit columns and is protected by **Row-Level Security** — see
> [Security → Tenant isolation](../admin/security.md#tenant-isolation-critical).

---

## How the schema is organized

- One file per domain under `drizzle/schema/*.ts`; tables are registered via `_registry.ts`.
- Shared column helpers (ids, `tenant_id`, timestamps, audit) come from
  [`drizzle/schema/utils.ts`](../../drizzle/schema/utils.ts).
- Migrations live in `drizzle/migrations/` and are applied with `npm run db:migrate` (never
  `drizzle-kit push` in production).

---

## Domains (by table count)

| Schema file | ~Tables | Domain |
| --- | --- | --- |
| `crm.ts` | 40 | Core CRM — contacts, companies, deals, leads, tasks, meetings, notes, tags |
| `core.ts` | 20 | Platform core — plans, modules, features, settings, backups |
| `infra.ts` | 19 | Infrastructure — tenants, users, sessions, API keys, roles, SSO |
| `automation.ts` | 19 | Workflows, sequences, automation rules, actions, logs |
| `comm.ts` | 16 | Communications — email, notifications, drafts, tracking |
| `billing.ts` | 14 | Invoices, invoice line items, payments, subscriptions, plans, tax |
| `tokens.ts` | 10 | Tokens/limits — OAuth tokens, budgets, login attempts, usage alerts |
| `ai.ts` | 7 | AI — insights, drafts, scoring, usage, providers, credits ledger |
| `support.ts` | 7 | Support — tickets, replies, SLA, services |
| `security.ts` | 5 | Security events, compliance requests, impersonation, retention |
| `lead-warming.ts` | 5 | Lead-warming campaigns, messages, replies, schedule |
| `usage.ts` | 4 | Usage snapshots, limit violations, alerts |
| `marketing.ts` | 4 | Forms, form submissions, segments |
| `projects.ts` | 3 | Projects, project tasks, milestones |
| `financial.ts` | 3 | Exchange rates, cost anomalies, revenue projections |
| `visitors.ts` | 2 | Visitors, page views |
| `territories.ts` | 2 | Territories, territory assignments |
| `templates.ts` | 2 | Templates, tenant templates |
| `teams.ts` | 2 | Teams and membership |
| `sms.ts` | 2 | SMS messages, SMS templates |
| `sla.ts` | 2 | SLA policies, SLA breaches |
| `segments.ts` | 2 | Segments, segment members |
| `plugins.ts` | 2 | Plugins, plugin execution logs |
| `modules.ts` | 2 | Modules, tenant modules |
| `knowledge.ts` | 2 | KB articles, KB categories |
| `history.ts` | 2 | Entity history, edit history |
| `hierarchy.ts` | 2 | Tenant hierarchy, hierarchy permissions |
| `files.ts` | 2 | File uploads / attachments |
| `esignature.ts` | 2 | Signing requests, signing events |
| `email-tracking.ts` | 2 | Email opens, email clicks |
| `documents.ts` | 2 | Documents, document folders |
| `custom-entities.ts` | 2 | Custom entity + field definitions |
| `compliance.ts` | 2 | Data retention policies, compliance records |
| `chat.ts` | 2 | Chat sessions, chat messages |
| `assignment.ts` | 2 | Assignment rules, assignment logs |
| `tasks.ts` | 1 | Task extensions |
| `super-admin-audit.ts` | 1 | Super-admin audit log |
| `record-links.ts` | 1 | Cross-record links |
| `platform.ts` | 1 | Platform-level settings |
| `dashboard.ts` | 1 | Dashboard layouts |
| `analytics.ts` / `analytics-views.ts` | 1 each | Saved analytics + views |
| `activity.ts` | 1 | Activity log |

_Counts are approximate (they reflect `pgTable` definitions and evolve with migrations). Always
confirm against the schema files._

---

## Key relationships (conceptual)

```
tenants ─┬─< tenant_members >─ users
         ├─< roles                     (RBAC: permissions JSONB)
         ├─< plans                     (entitlements & limits)
         ├─< contacts ─< deals         (deals reference contacts/companies)
         │        └─< activities, notes, tasks, follow_ups
         ├─< companies ─< contacts
         ├─< leads ──(convert)──> contacts + deals
         ├─< invoices ─< invoice_line_items
         │        └─< invoice_payments (append-only ledger)
         ├─< tickets ─< ticket_replies (SLA policies/breaches)
         ├─< automations / workflows / sequences ─< *_logs
         └─< audit_logs, security_events
```

- **Tenant scoping:** nearly every table above is keyed by `tenant_id`.
- **Billing integrity:** `invoice_payments` is append-only; invoice totals/status are recomputed
  from it (see [Sales Documents](../public/user-guide/sales-documents.md#invoices)).

---

## Working with the schema

```bash
npm run db:status          # migration status
npm run db:generate        # generate a migration from schema changes
npm run db:migrate         # apply migrations
npm run db:verify-chain    # verify migration chain integrity
npm run db:drift-check     # detect drift between schema and DB
npm run db:verify-isolation# confirm RLS/tenant isolation
```

See the [Deployment → Database lifecycle](../admin/deployment.md#database-lifecycle) for the full
workflow.

---

## Related

- Drizzle schema: [`drizzle/schema/`](../../drizzle)
- [Architecture → Data & storage](../admin/architecture.md#data--storage)
- [Security & Compliance](../admin/security.md)

# BASECRM — Rebuild Reference

> The complete, reverse-engineered specification of the **fixed** NuCRM base CRM.
> Read this set top-to-bottom and you can rebuild the same application from an
> empty repo: multi-tenant Next.js (app-router) + Drizzle ORM + PostgreSQL with
> **FORCE ROW LEVEL SECURITY**, a working industry-template system, and the
> RBAC/field-permission model that makes it safe to hand to a customer.
>
> This is documentation of an **existing** app, not a new build. Every claim
> below is pinned to a `file:line` in the merged tree (`main`). If code and doc
> disagree, the code is right — fix the doc.

## What counts as "base CRM" here

The failproof baseline the acceptance harness (`scripts/simulate-basecrm-acceptance.ts`,
PR #2653) proves live, 40/40 PASS:

1. **Tenancy & auth** — signup creates a tenant + admin; a plain member can log
   in and see only their own tenant (migration 0127 self-scoped SELECT policies).
2. **Onboarding** — a new tenant applies an industry template and gets real
   pipelines, stages, custom fields and automations.
3. **Templates** — `product_templates` (DB) is the single source of truth;
   apply is idempotent (double-apply → zero duplicates); superadmin can author a
   custom template and assign it to a tenant (idempotent re-assign).
4. **Field permissions** — restricting a role's field (e.g. `deals.amount:none`)
   is enforced on **every** read/write/export/import/bulk path, for **deals,
   leads, contacts, companies, tasks** — not silently a no-op.
5. **Core CRM flows** — deal/lead/contact CRUD, bulk actions, CSV import/export,
   PATCH that preserves columns you did not send.
6. **Auth safety** — login rate limiting keys per identity **and** per IP, and
   fails closed if the proxy IP is unavailable (#2630).

Everything else in this large repo (AI, marketing, billing, esignature,
knowledge base, plugins, chat, projects…) is **optional product surface** built
on the same substrate. The substrate — tenancy, RLS, RBAC, templates, core CRM —
is what this set documents for a faithful rebuild.

## How to read the set

| File | Covers | Start here if… |
| ---- | ------ | -------------- |
| [`01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) | Process model, layering, the request pipeline, pooling, env | you want the 30,000 ft view |
| [`02-DATA-MODEL.md`](./02-DATA-MODEL.md) | Schema layout, core tables, shared column factories | you are designing the DB |
| [`03-RBAC-AUTHZ.md`](./03-RBAC-AUTHZ.md) | Force-RLS policies, GUCs, role `can()`, field `enforce.ts`, auth/CSRF, rate limit | you are implementing authorization |
| [`04-TEMPLATE-SYSTEM.md`](./04-TEMPLATE-SYSTEM.md) | `product_templates`, materializer, idempotency, superadmin + onboarding | you are implementing templates |
| [`05-BUSINESS-FLOWS.md`](./05-BUSINESS-FLOWS.md) | Envelope + deals/leads/contacts CRUD/bulk/import/export, auth routes | you are implementing the API |
| [`06-REBUILD-GUIDE.md`](./06-REBUILD-GUIDE.md) | Empty repo → running app, ordered, with the acceptance gate | you are rebuilding it |
| [`07-OPS-NOTES.md`](./07-OPS-NOTES.md) | Env, DB role realign, worktrees, ports, migration-on-hotpatched-DB, deploy, gotchas | you are running/debugging it |

## The invariants (do not break these during a rebuild)

These are the properties that took the whole Part A/Part B effort to establish.
A "base CRM" that violates any of them is not this app:

- **Deny-by-default, FORCE RLS** on every tenant table. The app DB role is the
  table *owner* but **not** a Postgres superuser and has **no** `BYPASSRLS`, so
  policies bind it too. An unset `app.current_tenant` GUC denies (via
  `NULLIF(current_setting(...), '')::uuid`), it does not error. See 03-RBAC-AUTHZ.
- **Membership is visible before a tenant GUC exists.** `tenant_members` and
  `roles` carry SELECT-only, `app.current_user`-keyed policies (0127) so a login
  can resolve "which tenants am I in" with no tenant set yet. There is
  deliberately **no** super-admin bypass on those tables — one `app.is_super_admin`
  SET would flip ~60 policies. See 02-DATA-MODEL.
- **Field permissions STRIP, they do not 403** — except when the restricted
  column *is* the action (bulk/assign), which 403s. Reads drop disallowed keys;
  writes apply everything allowed and report the rest via `X-Stripped-Fields`.
  See 03-RBAC-AUTHZ.
- **Template apply is idempotent** and the DB is the source of truth. See 04.
- **Auth rate limiting fails closed.** No usable client IP on an auth action →
  503, never a shared `unknown` bucket. See 03/07.

## Provenance

Documented from `main` after PRs #2644 (template source of truth), #2647
(lead/contact/deals field coverage incl. the camelCase alias fix), #2648
(register re-pin), #2649 (companies/tasks field coverage), #2652 (post-merge
register drift), #2654/#2655 (settings fetch + CI enforcement), and the live
acceptance run 40/40 (nonce `AGLXXJ`). Line numbers are `main`-head era and
will drift; the file references and the invariants are the durable content.

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
- **Soft delete has a read half, and the read half is the invariant.** DELETE
  endpoints set `deletedAt`, not the row — but `tenant_isolation` filters by tenant
  and **not** by `deletedAt`, so a tombstone is still physically present and FORCE
  RLS will return it. **Every `SELECT` against any table carrying `deletedAt` must
  filter `isNull(<table>.deletedAt)`.** Omitting it is the #3224/#3228 defect class
  (lead-warming mailed soft-deleted contacts; send sinks + AI hydrations did the
  same) — both shipped with the write half *correct*, so the code looked fine. See
  02 § factories.
- **A pre-auth credential read must name the credential, and RLS SELECT gates
  UPDATE.** A pre-auth read of `password_resets` / `email_verifications` /
  `oauth_codes` has to compare against `app.token_credential`, never just flip the
  boolean `app.auth_lookup` (0134 gated on the boolean alone → any pre-auth read saw
  every live row of three secret-bearing tables; 0135 narrowed it). Corollary: an
  RLS `UPDATE` is checked against the table's SELECT policies and its `RETURNING` is
  filtered by them too, so a claim that cannot see its own row silently updates zero
  rows. See 03 § 1 (pre-auth redemption) for the four GUCs
  (`app.auth_lookup`, `app.token_issue`, `app.token_credential`, `app.token_retire_user`).

## Provenance

Documented from `main` after PRs #2644 (template source of truth), #2647
(lead/contact/deals field coverage incl. the camelCase alias fix), #2648
(register re-pin), #2649 (companies/tasks field coverage), #2652 (post-merge
register drift), #2654/#2655 (settings fetch + CI enforcement), and the live
acceptance run 40/40 (nonce `AGLXXJ`). Line numbers are `main`-head era and
will drift; the file references and the invariants are the durable content.

**Re-drilled 2026-10-25 against `main = 2d8aed836` (#3232).** The wrong citations
were re-pinned (the `0079`→`0080` drop-migration, five `schemas.ts` coordinates, the
`token-credential-context.ts` auth helpers + `rls.ts:32-39` re-export, the
`request-connection.ts` reset site, and the `lib/.../resolve-stage.ts` path), the
`amount` default was corrected to the numeric `.default(0)`, and the two invariants
above (soft-delete read half, pre-auth credential-name rule) were added. Each moved
citation keeps its superseded number in a dated `(re-pinned 2026-10-25 from :X)`
parenthetical so the next audit can tell a fix from a guess. Line numbers here are
valid only at that SHA — trust the **symbol names** (`dealQuerySchema`,
`RESET_TENANT_GUCS_SQL`, `withAuthLookupContext`, `stageFailureMessage`) over any raw
`:N`. `0136_pre_auth_oauth_rls.sql` / `app.oauth_client_id` were **not** in this tree.

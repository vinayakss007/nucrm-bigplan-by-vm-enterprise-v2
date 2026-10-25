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
- **Soft delete is two-sided.** 199 of the 226 tables carry `deleted_at`; writing
  the tombstone is the easy half and every route does it. **Every read must
  compose `isNull(<table>.deletedAt)`**, including hydration reads one hop away
  (`deals → contacts`, `invoices → contacts`) — RLS does not hide your own
  deleted rows, and the code looks correct without it. Two shipped defect
  classes came from the missing half (#3224 outbound mailing, #3228 send sinks +
  AI hydrations). See 02 "Soft delete is a two-sided rule".
- **A pre-auth grant must name the credential.** `password_resets`,
  `email_verifications` and `oauth_codes` are readable before anyone is
  authenticated, so the grant is a GUC — and a **boolean** GUC
  (`app.auth_lookup`) on a secret-bearing table is a cross-tenant read: 0134
  shipped that mistake and any pre-auth read saw every live token. Arms must
  compare `app.token_credential` against the table's credential column. Related
  trap: an RLS `UPDATE` (or `DELETE`) is gated by the table's `SELECT` policies
  too, so a claim
  that cannot see its own row consumes nothing *silently* — hence the
  no-liveness `*_token_claim_read` arms. 0136 extends both to the OAuth
  (`oauth_clients`, `oauth_tokens`) and adds a **separate** credential slot for
  the client id (`app.oauth_client_id`) — never reuse `app.token_credential` for
  it, or a client assertion satisfies a bearer predicate. See 03 § 1a.

## Provenance

Documented from `main` after PRs #2644 (template source of truth), #2647
(lead/contact/deals field coverage incl. the camelCase alias fix), #2648
(register re-pin), #2649 (companies/tasks field coverage), #2652 (post-merge
register drift), #2654/#2655 (settings fetch + CI enforcement), and the live
acceptance run 40/40 (nonce `AGLXXJ`). Line numbers are `main`-head era and
will drift; the file references and the invariants are the durable content.

**Re-drilled 2026-10-25 against `main = 868681d91`, then re-pinned against
`main = 854424749` (#3232).** All 215 backticked file references were resolved
against the tree: the 14 migration citations (`0037:238`, `0039:12`,
`0054:13/147/263`, `0088:74/413/485/493`, `0127:50/59`) are exact, and the set was
corrected on five that had moved —
`0079_drop_pipeline_stages.sql` → `0080_` (the schema comment at
`drizzle/schema/crm.ts:882` carried the same wrong number), five
`lib/api/schemas.ts` limits/aliases that were 130–165 lines stale, the
auth-context helpers that left `lib/db/rls.ts` for
`lib/db/token-credential-context.ts`, and one path written as
`lib/.../resolve-stage.ts`. Two invariants that landed *after* the first edition
were absent from it and are now stated above: the two-sided soft delete (#3224,
fixed by #3227 — merged; #3228, fixed by #3229 — open) and pre-auth credential
naming (0134, 0135, #3102, #3218).

The re-drill ran *while* #3230 was landing, so it also proved the workaround:
that PR shifted the `RESET_TENANT_GUCS_SQL` constant three lines further down
`request-connection.ts` (and its call site four), grew `rls.ts` 337→339 lines,
added two helpers, and added one new GUC.
**Cite the symbol** (`RESET_TENANT_GUCS_SQL`, `dealQuerySchema`,
`withAuthLookupContext`) in preference to a bare number when you re-pin — the
register had the same lesson as #3201. Where a number is unavoidable this set
gives the definition site and names the owner helper, not a call site inside it.

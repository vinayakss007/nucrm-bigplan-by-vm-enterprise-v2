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
  Three more migrations re-ran the same two traps and added two more rules:
  **a credential column no policy names is unrevocable** (0136 admitted only
  `refresh_token`, so `/oauth/revoke` silently deleted zero `access_token` rows
  until 0137), **every arm needs its own read** (0137/0138 each ship a
  `*_claim_read` SELECT beside the write), and **the privilege GUC and the
  row-narrowing value can be one and the same** (0138's
  `app.unsubscribe_contact`). Any new one of these has to be appended to *both*
  connection-reset lists — `tests/unit/rls-unsubscribe-contact-guc-3237.test.ts`
  pins the two lists equal and pinned to the literal count.
- **A queue default is a side-effect decision.** `lib/queue/index.ts:130` hands every job
  `attempts: 3`, and for a job whose work is "mail these people" a retry is a re-send:
  the processor restarts its recipient list at index 0 with no claim and no dedupe key,
  and the addresses are masked out of the result set so a retry cannot even be resumed.
  `send-bulk-emails` is therefore queued with `attempts: 1` (#3293). Before accepting any
  retry default, ask what the processor does on the *second* run. See 07 § Background jobs.
- **A guarded table is not a usable table: a policy is not a writer.** `oauth_clients` has carried
  `tenant_isolation` `FOR ALL` since 0088 and had **no `INSERT` anywhere in the app**, so
  `POST /api/auth/oauth/token` answered `invalid_client` — byte-identical to a wrong secret, since
  `app/api/auth/oauth/token/route.ts:69` and `:79` return the same 401 — for every caller on a fresh
  database. The writer is `app/api/tenant/oauth-clients/route.ts:89`, and it needed no migration.
  Two rules: **check what the existing arms already reach before adding one**, and when an auth
  route rejects *everyone*, ask whether the row it reads can exist at all. See 03 § #3328.

## Provenance

Documented from `main` after PRs #2644 (template source of truth), #2647
(lead/contact/deals field coverage incl. the camelCase alias fix), #2648
(register re-pin), #2649 (companies/tasks field coverage), #2652 (post-merge
register drift), #2654/#2655 (settings fetch + CI enforcement), and the live
acceptance run 40/40 (nonce `AGLXXJ`). Line numbers are `main`-head era and
will drift; the file references and the invariants are the durable content.

**Re-drilled 2026-10-25 against `main = 2d8aed836` (#3232).** The wrong citations
were re-pinned (the `0079`→`0080` drop-migration, five `schemas.ts` coordinates, the
`token-credential-context.ts` auth helpers + `rls.ts:32-41` re-export, the
`request-connection.ts` reset site, and the `lib/.../resolve-stage.ts` path), the
`amount` default was corrected to the numeric `.default(0)`, and the two invariants
above (soft-delete read half, pre-auth credential-name rule) were added. Each moved
citation keeps its superseded number in a dated `(re-pinned 2026-10-25 from :X)`
parenthetical so the next audit can tell a fix from a guess. Line numbers here are
valid only at that SHA — trust the **symbol names** (`dealQuerySchema`,
`RESET_TENANT_GUCS_SQL`, `withAuthLookupContext`, `stageFailureMessage`) over any raw
`:N`. That pass recorded that `0136_pre_auth_oauth_rls.sql` / `app.oauth_client_id`
were not in the tree it read. They were true of `2d8aed836` and of nothing since:
`#3230` landed 0136 four commits later.

**Re-measured 2026-10-25 against `main = 2ff3e88b5` (#3244).** The tree moved under
the doc again. `#3236` added 0137 and `#3242` added 0138,
`lib/db/unsubscribe-contact-context.ts` and a **fourteenth** reset GUC, which pushed
`RESET_TENANT_GUCS_SQL` from `lib/db/request-connection.ts:101` to `:103` and its
issue site from `:249` to `:251`. Re-pinned here: 01's context-helper and
reset bullets plus a fresh sizing census (**918** `*.test.*` files — 866 unit /
39 integration / 12 dashboard / 1 api; **139** journal steps; **277** `.sql` files),
02's GUC list reorganised by *writing file* (rls / token-credential / portal-lookup /
form-capture / unsubscribe-contact) instead of pretending everything lives in
`rls.ts`, and 03's pre-auth walk extended to 0134–0138 with `rls.ts:118`→`:120`.
Two assertions from the `docs/basecrm-citation-drill` branch are deliberately **not**
ported because they contradict the code: that the reset clears *twelve* GUCs, and
that `app.oauth_client_id` is absent from the reset lists. **That sentence is now
itself behind the branch it describes**: `#3234` has been re-pushed since
(head `206a35b64`, 2026-10-25 15:47Z) and its head now names `app.oauth_client_id`
where it belongs, but still says **thirteen** GUCs cleared where the code clears
fourteen — one short of `#3242`'s `app.unsubscribe_contact`. The count is therefore
not remembered in prose by anyone any more:
`tests/unit/basecrm-citation-drill-3244.test.ts` counts the `set_config(` calls on
`pool.ts:241` and `request-connection.ts:104` and fails if the docs say anything
other than what they hold.

**Re-checked 2026-10-25 against `main = 33f0b7306` (#3241's CI job).** One merge moved
a number and no coordinate: the sizing census is **919** `*.test.*` files — **867** unit
/ 39 integration / 12 dashboard / 1 api, the +1 being
`tests/unit/ci-constraint-vocab-job-3241.test.ts`. The journal is still **139** entries
(highest `idx` 138) over **277** `.sql` files, `RESET_TENANT_GUCS_SQL` is still
`request-connection.ts:103` issued at `:251`, and the reset still clears the same
**fourteen** `app.*` GUCs — `#3241` wired an existing guard into CI and added no GUC,
no migration and no schema table, so 01/02/03's pins are untouched by it.

**Re-drilled a third time the same day, against `main = 5760c2538` and landed on
`main = 54be92020` (#3244's follow-up).** The `:N` set was re-derived with a scanner over
every `file.ext:NNN` in this directory and each hit checked by hand, which found four
wrong pointers, one stale census figure and one wrong *claim* among the things the
previous two passes had left. The scan counts **155** coordinates: **57** carry a path
long enough for the tripwire to resolve them on its own, and the other **98** are bare
`file.ext:NNN` — the test only resolves those where its `PINNED` pairs name the file, so
the remainder were checked by hand this pass and are what the next hand pass inherits.
Both figures are of the text *after* this pass edited it, which is the only honest way
to count the citations in a document a change is rewriting.

- `03` § 2 cited `requireAuth` at `middleware.ts:341`. `:341` is the
  `COALESCE(roles.permissions, …)` select line — a line `01:51` cites correctly for
  exactly that — while `01`'s own heading and `06` step 5 both said `:200`. The file
  disagreed with itself for a whole audit cycle because a wrong number in a 500-line
  file still lands on something plausible.
- `02`'s "name + file only" list sent `sessions`/`refresh_tokens`/`invitations` to
  `core.ts:217…`, which is `field_permissions` — the next entry in the same list.
- `05` cited `resolveDealStage` at `resolve-stage.ts:117`: that is the last line of the
  function's body (`return { ok: false, reason: 'missing' }`), not the function
  (`:82`). Where a bullet says "the create path *calls* X", the pointer is to X.
- `06` step 4 introduced its helper list as "GUC helpers in `lib/db/rls.ts`" and named
  `withAuthLookupContext` in that list. Only four of the helpers are *defined* there;
  `withAuthLookupContext` is defined at `lib/db/token-credential-context.ts:90` and
  reaches `rls.ts` through the re-export at `lib/db/rls.ts:32-41`, and
  `withUnsubscribeContactContext` (`lib/db/unsubscribe-contact-context.ts:120`) is not
  re-exported at all. `01:88-96` had this right the whole time — the step was a summary
  that had drifted from the section it summarised, so it now says which file defines
  what, because a rebuilder who greps `rls.ts` and finds nothing will conclude the
  helper is missing rather than re-exported.
- The sizing census moved again, and by the arithmetic this doc keeps failing to do
  itself: **921** `*.test.*` files — **869** unit / 39 integration / 12 dashboard / 1
  api. The `919`/`867` the previous paragraph recorded is exactly `#3248`'s and
  `#3250`'s two new test files, both merged after it was written. The journal is still
  **139** entries (highest `idx` 138) over **277** `.sql` files. This follow-up's own
  `tests/unit/basecrm-citation-drill-3244.test.ts` is the next `+1`: on the branch that
  adds it the census reads **922** / **870** unit, and a reader who measures a tree
  containing it and finds `921` is looking at `5760c2538`, not at a defect.
- The claim: `03` § 1 and `06` step 3 described the shipped `tenant_isolation` policy as
  0037's — strict WITH CHECK, and "a query with no GUC returns 0 rows". `0039:64-75`
  replaced that policy on every table that had it with a **USING-only** statement whose
  expression is `tenant_id IS NULL OR tenant_id = …`, unconditionally (0039 does not
  branch on nullability the way `0037:239`/`:241` do). A `FOR ALL` policy with no WITH
  CHECK reuses its USING for writes — the rule `0136:45` states — so the write check for
  a NULL `tenant_id` is gone, and a no-GUC query returns the *global* rows on any table
  whose `tenant_id` is nullable. Both bullets now say which of 0037/0039 is being
  described, because a rebuild that followed the old wording would have written a
  checkpoint that fails on a table that is behaving correctly.

Nothing here is guarded by CI: no workflow screen reads a `docs/BASECRM/**` citation,
which is why three audits in one day each found a new set. `tests/unit/` grew a
resolution test for the pinned subset instead — see `#3244`'s follow-up PR — so the
next merge that moves a line under a cited symbol fails a test rather than a reader.
What that test can and cannot promise is worth stating, because the difference is the
whole reason this directory keeps rotting: it asserts *pairs* (the doc still carries the
pointer **and** the cited line still carries what the pointer promises) for the
hand-resolved coordinates, range-checks the 57 path-bearing citations against their
files, and re-derives the 0037/0039 policy shape and the reset list's GUC count from
migration and connection text. It cannot check a *sentence*: `05`'s `bulk/route.ts:29`
matches nine tracked routes, so an abbreviated citation only fails when it is past EOF
in every one of them, and no test notices if the prose next to a still-correct line
number stops describing it. That residue is what the hand pass is for.

**Re-counted 2026-10-26 against `main = 32e673a1b` plus #3246's plugin-webhook arm.**
One branch moved three of these numbers at once and 02/03's reset-list claims with
them: 0139 is the `idx`-139 step (**140** journal entries over **280** `.sql` files —
140 forward, 140 `.down.sql`, the last gap closed by #3284), `app.plugin_webhook_id`
is the **fifteenth** name on both reset lists, and the tree now holds **926**
`*.test.*` files. Nothing here remembers those counts by hand:
`tests/unit/basecrm-citation-drill-3244.test.ts` counts the `set_config(` calls itself,
so 02, 03 and that test moved together in #3246 instead of one of them drifting. `03`
§ 1 gained 0139 as the fourth worked example, because it is the same dead endpoint on a
table whose `tenant_id` is NOT NULL — and, unlike 0136–0138, the dead half was the
*read*: one SELECT-only arm, no write granted, and the migration lands UNAPPLIED with
the rest of the backlog.

**Re-counted again 2026-10-31 for the 0140–0142 journal repair.** Four up-migrations
(0140 jsonb size, 0141 ai-providers FORCE RLS, 0141 quote-webhook lookup, 0142
whatsapp phone lookup) had landed on disk while a merge resolution dropped their
journal entries, so the chain screen saw orphans. The journal now carries **145**
entries over **290** `.sql` files — 145 forward, 145 `.down.sql` — and the tree holds
**1002** `*.test.*` files. Steps 4c/4d also appended `app.quote_webhook_id` and
`app.whatsapp_phone_number_id` to both reset lists, so both now clear **nineteen**
GUCs, and `app/api/webhooks` plus the ten `lib/` files #3312 pinned leave **107** reads
in **4** counted deferrals across a **120**-file anonymous walk (the guard re-derives
all four). The migrations remain UNAPPLIED with the rest of the backlog (#2537).

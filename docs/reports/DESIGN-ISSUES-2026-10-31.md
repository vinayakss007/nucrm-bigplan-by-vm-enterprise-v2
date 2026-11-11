# NuCRM — Recurring System-Design Issues

**Date:** 2026-10-31 · **Branch:** `fix/operational-pool-tls-3381` (working tree)
**Companion:** visual map at [`../architecture/SYSTEM-MAP.md`](../architecture/SYSTEM-MAP.md)
and [`../architecture/system-map.html`](../architecture/system-map.html).

---

## 0. TL;DR

This codebase is **not** suffering from sloppiness. It has zero `TODO`/`FIXME`
markers, zero `@ts-ignore`, six `as any`, two skipped tests, 146 migrations each with a
down-migration, ADRs, and 37 guard scripts. It is suffering from **nine invariants
that have no single choke point**. Because each invariant is upheld by
convention and patched per call site, the same bug returns under a new name,
and the failure is almost always **silent** (zero rows, empty list, "job
queued", "not found") rather than loud.

Ranked by blast radius:

| # | Issue | Why it recurs | One-line fix |
| --- | --- | --- | --- |
| **P0** | **Pooling mode contradicts the RLS design** | ADR-0003 assumes transaction pooling + `DISCARD ALL`; preprod documents that pairing as inert and uses session mode; `.ini` and prod compose still say `transaction` — **as of 2026-11-03 this row is the audit's evidence, not the tree: #3404 (PR #3445) made session the declared mode everywhere and added `guard:pool-mode`, which PARSES the compose files; the `SHOW pool_mode` boot assertion is the stated residual** | Make session mode the only accepted mode; assert `SHOW pool_mode` at boot |
| **P0** | **Code paths depend on RLS being off** | 4 of 6 webhook routes write FORCE-RLS tables with no tenant GUC; `tenants` UPDATE requires `app.current_user` — **all six are wrapped as of `84ae3767` (#3436 billing pair, #3246 the rest); what is left is integration evidence for `payu` and `whatsapp`, and the guard** | Give webhooks an explicit system context; make "no context" a type error |
| **P1** | **Soft-delete is a convention — and the auth path resurrects tombstoned users** | 200/226 tables carry the column; 0 of 241 policies mention it; ~69% of reads do not filter; password reset ignores it | `deleted_at IS NULL` in every RLS policy + `live()` helper |
| **P1** | **Status transitions are re-encoded per route** | 134 status writes; only 36 name a from-state; 4 competing concurrency helpers | One `transitionStatus()` + a per-table transition registry |
| **P1** | **Failure is a value nobody must consume** | `sendEmail` returns `{success:false}`; 3 of 29 callers ignore it; 4 success envelopes; 202 files use raw `fetch` | `Result<T,E>` + one envelope + one typed client |
| **P1** | **Denormalised counters have no owner** | 33 mutation sites across 20 files; 6 insert paths never touch `tenants.currentContacts`; quota check outside the insert tx | DB triggers + nightly reconcile + in-tx quota |
| **P1** | **Scheduled work has three owners — and two jobs run nowhere** | 22 cron routes split 17/18/18 across crontab, `vercel.json` and the in-process scheduler; `process-lead-scoring` and `sla-check` appear in **none**; production crontab omits `recurring-invoice-generator` and `lead-warming`; the guard treats this as tracked debt | One manifest generates all three schedules; fail on parity; schedule or delete the orphans |
| **P1** | **Background jobs fall back to a queue nobody consumes** | Producers try Redis → **pg-boss** → memory; the only worker is BullMQ; the adapter is cached for the process lifetime, so one Redis blip routes every later job into an unread queue | Delete the pg-boss path or give it a consumer; make "enqueued" mean "a live consumer exists" |
| **P1** | **Authorization is a configurable control plane with partial enforcement** | 66/248 mutating tenant routes gate on nothing but "is logged in"; the role UI's 66-id catalog and the 74 permission strings routes check are different vocabularies (21 un-grantable, 16 advertised never checked); `record_permissions` has **zero** enforcement call sites | Route every handler through one `authorize(entity, action)` choke point generated from the catalog; make an ungated mutating route fail CI |
| **P2** | **Enforcement is bespoke and voluntary** | 37 regex guards, 0 use an AST; 36 of the 37 do run in some workflow, and none of them can see the code they claim to check; 511 line-number citations cause ~25% of commit churn | Cut to ~12 structural, AST-backed guards; cite symbols and commands, not lines and counts |

### What to fix first

1. **P0.4** — tombstoned users can still reset their password and mint a session.
   Smallest change in this document; closes a real security path.
2. **P0.1 + P0.2** — make session pooling the only mode, then give webhooks an
   explicit system context. Together these make RLS a backstop instead of a
   coin flip.
3. **P1.6** — schedule the five orphaned cron routes, starting with
   `recurring-invoice-generator` (revenue) and `sla-check` (customer promises).
4. **P1.7** — remove the queue fallback that accepts work it cannot deliver.
5. **P1.8** — add a permission check to the 66 ungated mutating routes, starting
   with `invoices`, `products`, `contracts` and `subscriptions` (any member,
   including `member`, can currently create or send them).

Also found in the **current working tree** (uncommitted): `scripts/restore-db.ts`
imports `pgSslConfig` twice — `tsc` rejects it (TS2300), and CI does not see it
because `scripts/**` is excluded from typecheck. See [§4](#4-in-flight-branch-3381-review).

---

## 1. Method and confidence

- Nine parallel read-only audits: tenant/RLS, soft-delete, lifecycle, result
  contracts, counters/quotas, guard estate, infra/config, scheduled work, and
  background-job delivery. H9 (authorization enforcement) was measured directly
  on the follow-up pass: route-gate coverage, catalog/checked-string diff, and
  importer counts for each RBAC module.
- Direct verification of every P0/P1 claim in this document (grep, file reads,
  `tsc` probe, running `npm run guard:pool-tls`, `check-cron-lock.mjs` and
  `check-cron-auth.mjs`).
- The schedule matrix in H7 is computed from the three source files, not copied
  from a comment; the command is in §8.
- Commit-family counts are **subject-only**, over the last 1,000 non-merge
  commits: `re-pin` 56, `RLS` 46, `claim` 25, `stale` 20, `pool` 12,
  `tombstone` 8, `tenant context` 7.
- **Re-measured on `origin/main` on 2026-11-03**, three days after filing, because
  #3401/#3403/#3413/#3408-partial had already merged. That pass changed the guard
  census (36→37 scripts, and the wiring story from "CI runs 30, 4 run nowhere" to
  "36 run somewhere, 33 of them in `ci.yml`"), the register size (5,502→5,790 lines,
  479→511 citations), and three webhook claims. It also caught **two errors of this
  author's own making**: a workflow grep that could not see bare `node scripts/…`
  invocations, and a `page.tsx$` path glob that counted a component named
  `client-page.tsx` as a page. Both are now §8's problem, not this document's
  numbers — see H6 and the note under `SYSTEM-MAP.md` §Inventory.
- **And then moved again the same day, by this report's own follow-up work.**
  #3404 landed `guard:pool-mode`, taking the estate to **38 aliases / 38 distinct
  scripts / 11,624 lines** with **34 named in `ci.yml`** (31 by alias + 3 bare), so
  37 run somewhere and `guard:migration-redecl` alone still runs nowhere. H6's numbers
  above are the 2026-11-03 snapshot and are left as measured; `SYSTEM-MAP.md`, being
  the living reference, carries the new ones. This is the behaviour the finding asks
  for — the count is evidence of churn, so quote §8's command, not this bullet.
- Line numbers drift (that is itself finding H6). Where a number is load-bearing
  the symbol name is given too.

**Confidence:** high on the structural claims and the P0 items; medium on exact
call-site counts, which move with every merge.

---

## 2. The unifying pattern: invariants without a choke point

Every recurring family has the same shape:

```
correct code  =  call-site discipline × N
failure mode  =  the discipline is omitted, and nothing errors
```

| Invariant | Where it must be remembered | What happens when forgotten |
| --- | --- | --- |
| "Open a tenant context before querying" | every route, webhook, cron, script, page | RLS denies → **0 rows**, looks like "not found" |
| "Filter the tombstone" | every read of 199 soft-deletable tables | deleted records reappear |
| "Claim the from-status in the WHERE" | every status write | stale write wins; two actors both "succeed" |
| "Check `sendEmail().success`" | 29 call sites | "sent" reported, nothing delivered |
| "Maintain the counter" | 33 write sites | quotas drift; billing/limits wrong |
| "Put the job in the schedule" | 3 schedule files, 22 routes | route exists, never runs; the panel stays green |
| "Enqueue only where a consumer listens" | 1 producer function, 10 job types | "queued" reported; the message is never delivered |
| "Check a permission before mutating" | 248 mutating routes, 4 parallel mechanisms | any logged-in member performs the action; UI role settings are inert on those routes |
| "Record the line you changed" | 511 doc citations | CI red; re-pin PR churn |

The observation that ties this together: **the system's dominant failure mode is
silence.** Policies fail closed to zero rows (`NULLIF(current_setting(...))`),
`UPDATE … WHERE status = $from` returns `rowCount = 0` without an error, counters
drift by small integers, a cron route with no schedule simply never fires, a job
accepted by a consumer-less queue simply never arrives, and pages render `[]` as
"No records yet". There is almost no loud failure to catch in monitoring. That
is why the same class of bug survives tests and reappears.

---

## 3. The nine recurring families

### H1 — Tenant context and RLS (CRITICAL)

**Root cause.** RLS context is an ambient side effect written onto a pooled
connection, while the DB client is a globally importable singleton. Nothing joins
"this statement runs" to "a tenant GUC is set on this connection".

**Evidence**

- **15 distinct GUCs**, ~20 exported helpers, 9 modules:
  `app.current_tenant`, `current_user`, `is_super_admin`, `auth_lookup`,
  `tracking_lookup`, `portal_lookup_token/tenant/email`, `form_lookup_id`,
  `token_issue`, `token_credential`, `token_retire_user`, `oauth_client_id`,
  `unsubscribe_contact`, `plugin_webhook_id`
  (`lib/db/rls.ts`, `token-credential-context.ts`, `portal-lookup-context.ts`,
  `form-capture-context.ts`, `plugin-webhook-context.ts`,
  `unsubscribe-contact-context.ts`).
- **532 files import `@/drizzle/db`**; 522 of them are outside `lib/db`.
- Of 519 route handlers, 312 touch the DB. **277 are wrapped in `withApiRoute`;
  35 are not, and 8 of those open no context at all** (e.g. PayU webhooks, SCIM).
- **4 of the 6 provider webhook routes have no context**: `payu`, `razorpay`,
  `stripe`, `whatsapp`. They write `quotes`, `invoices`, `invoice_payments`,
  `subscriptions` and `tenants`. `invoice_payments`, `tenants` and `users` are
  **FORCE RLS**. `tenants_authenticated_update` requires
  `current_setting('app.current_user') != ''` (`0054_rls_phase0.sql:151-153`),
  and migration `0100` documents this exact failure: *"UPDATE … rowCount = 0
  (silent) … every job logged success while changing nothing."*
  > **Closed since the audit, and #3403 is closed for it** — `razorpay`/`stripe`
  > by **#3436** (`lib/db/billing-webhook-context.ts`), `payu`/`whatsapp`/`resend`
  > by **#3246**. Re-checked 2026-11-03 on `84ae3767`; the residual is *evidence*
  > (`payu` and `whatsapp` have no integration test that reads the row back) and the
  > guard at the next bullet, not four unwrapped routes. See FIX-PLAN §3 PR-1B — and
  > note that the §8 loop below kept reporting `ctx=0` for three already-fixed files,
  > because a per-file grep of helper *names* cannot see `withTenantScope` and cannot
  > follow a payload into `lib/whatsapp/webhook-processor.ts`. That is this bullet's
  > own point, demonstrated on the report that made it.
- **The guard cannot see this.** `scripts/check-rls-route-coverage.mjs` checks
  identity tables only in a few entry files, exempts any file that merely
  *mentions* a helper, and never scans `app/api` for tenant business tables.
  Server actions, pages and scripts are out of scope.
- **No structural guarantee**: no branded type, no `no-restricted-imports`, no
  runtime assertion tying a query to a GUC.

**Why the current backstop cannot simply be switched on.** Whether RLS is even
enforced depends on three things that disagree across environments:

| Setting | ADR-0003 says | Preprod ships | Prod compose / `.ini` ships |
| --- | --- | --- | --- |
| `pool_mode` | `transaction` | **`session`** | **`transaction`** |
| `server_reset_query` | load-bearing `DISCARD ALL` | `DISCARD ALL` | `DISCARD ALL` (**inert in tx mode**) |
| `PGBOUNCER_ENABLED` | implied | `true` | `false` (direct `postgres:5432`) |
| FORCE RLS | "off" | on for 13 tables | on for 13 tables |

In transaction mode, a session-scoped GUC (`is_local=false`) does not survive
between statements on a pooled backend, and pgbouncer does not run
`server_reset_query`. Pinning one pool-*client* cannot bind a pool-*backend*.
So `withApiRoute`'s RLS backstop is functional in preprod and not in the shape
the ADR describes.

**Highest-leverage fix.** Stop exporting the raw client from `lib/db`:

```ts
// lib/db/index.ts — the only DB entry point
export function withTenantDb<T>(tenantId: string, userId: string,
                                fn: (db: TenantDb) => Promise<T>): Promise<T>;
export function withSystemDb<T>(fn: (db: SystemDb) => Promise<T>): Promise<T>;
```

with a branded `TenantDb`, `SET LOCAL` inside one transaction, deletion of every
`tx?`-optional session-scoped overload, and `no-restricted-imports` on
`@/drizzle/db` + `getPool()` outside `lib/db`. Add a boot assertion for role and
pool mode. A missing context then becomes a **type error**, not a zero-row shrug.

---

### H2 — Soft-delete / tombstone (one security path)

**Root cause.** Soft delete is an application convention, not an invariant.
**200 of 226 tables** carry `deleted_at` (via `utils.audit()` / `utils.lifecycle()`
plus one hand-declared column in `support.ts`), and **none of the 241 RLS
`CREATE POLICY` statements mention it** — a tenant-scoped `SELECT` returns
tombstones. There is no Drizzle extension, no liveness view, and no policy arm
that makes `WHERE deleted_at IS NULL` automatic.

**Evidence**

- **570 hand-written predicates** — 434 `isNull(<t>.deletedAt)` plus 136 raw
  `deleted_at IS NULL` — spread over 221 files.
- **1,264 reads** of soft-deletable tables: 390 (31%) filter in-statement;
  ~768–874 (69%) do not, across **242 API route files** (154 under
  `app/api/tenant`).
- Verified leaks: `contacts/[id]/notes` returns notes for a tombstoned contact;
  `contacts/[id]/timeline`, `/lifecycle`, `/status` likewise;
  `deals/[id]/products` DELETE tombstones the row but GET ignores it;
  `invoices/[id]/pdf` renders deleted line items and a tombstoned contact name.
- **Security path:** `forgot-password` resolves `users` by email with no tombstone
  predicate (`app/api/auth/forgot-password/route.ts:71-77`), and `reset-password`
  then sets a new password and inserts a session
  (`app/api/auth/reset-password/route.ts:74-87`). A soft-deleted user can be
  resurrected through password reset.
- **Restore vs unique keys:** 42 unique indexes on soft-deletable tables, only
  **8 partial**; 28 column-level `.unique()` are non-partial. Deleting and
  recreating a team named "Sales" hits `23505` because `idx_teams_tenant_name`
  includes tombstones, while `custom_entities`, `ai_draft_templates` and
  `invoices.quote_id` allow key reuse and then collide on restore.
- **No cascade:** soft delete bypasses `ON DELETE CASCADE`, so child rows stay
  visible — deals, tasks and reports still join a tombstoned contact.
- The guard `scripts/check-portal-soft-delete.mts` defaults to
  `app/api/public`; its floor is 100 tables against 200 in the schema.

**Highest-leverage fix.** Put the rule in the database and the type system:

1. one generated migration adding `deleted_at IS NULL` to the `SELECT USING`
   clause of every policy on the 200 tables, with an `app.include_deleted` GUC
   elevated only by trash/restore (mirroring `setSuperAdminContext`);
2. make the 34 missing unique indexes partial;
3. one shared `live(table)` predicate instead of copy-pasted `isNull`;
4. widen the guard to `app/api/**`, `lib/**`, pages and cron, with child and
   index checks.

That converts ~570 predicates into one DB invariant.

---

### H3 — Lifecycle state and concurrency

**Root cause.** No component owns a status column. Statuses are `text` with, at
best, a value-vocabulary CHECK — never a transition rule. The transition rule is
re-encoded 3–5 times per entity (Zod enum, inline route map, a `lib/offers` map,
a schema comment, a DB CHECK), and the write is always
`SELECT → vet in JS → UPDATE … WHERE id = ?` (tenant sometimes). Postgres never
rejects the stale write.

**Evidence**

- **134** `.update().set({status})` calls in `app/` + `lib/`; **36** name a
  from-status in the `WHERE`; **98** do not.
- Of 42 single-row commercial writes across 11 entities: 20 claim a from-status,
  2 use `updatedAt` CAS, **20 have no state guard at all**.
- **0 `pgEnum`** in `drizzle/`; all statuses are text plus 31 CHECK constraints.
- **4 competing concurrency helpers**, all opt-in and fail-open:
  `lib/api/concurrency.ts` (`concurrencyGuard`, ~98 sites), `lib/concurrency.ts`
  (`withConcurrencyGuard`, 9), `lib/api/optimistic-lock.ts` (`checkConcurrency`,
  4), `checkStaleUpdate` (10). No `version` column anywhere.
- Side-effects are not atomic with the status write: deal stage change →
  notifications/webhooks fire-and-forget (`deals/[id]/route.ts:198-259`);
  invoice send → SMTP before status claim; subscription cancel → Stripe before DB
  write. **No outbox exists.**

**Highest-leverage fix.** One `transitionStatus(tx, table, id, tenantId,
from[], to, effects)` backed by a per-table `TRANSITIONS` registry that emits
`UPDATE … WHERE id = ? AND tenant_id = ? AND status = ANY($from)`, returns 409 on
zero rows, and generates the DB CHECK/trigger so no route can bypass it. Make
notification/webhook helpers `tx`-aware or add an outbox.

---

### H4 — Result contracts and read states

**Root cause.** Failure is a value with no enforced consumer, and every boundary
re-invents its shape.

**Evidence**

- `sendEmail` returns `Promise<SendResult>` and converts every provider failure to
  `{success:false}` (`lib/email/service.ts:249`). TS does not require reading it.
  **3 of 29 call sites ignore it** (`lib/automation/workflows.ts:34`,
  `lib/email/service.ts:341`, `offers/[quoteId]/send/route.ts:211-218` — the last
  returns `{ok:true,status:'sent'}` on failure).
- **Eight** result-object shapes and no shared `Result<T,E>`; `sendSmartEmail`
  returns `{success:true}` in one branch and throws in another.
- **2,731** `NextResponse.json({...})` bodies with four success vocabularies:
  `data` 445, `ok` 257, `success` 52, plus 154 bespoke shapes. Pagination splits
  between top-level `total` (46) and nested `pagination` (9).
- Frontend: **202 files / 523 raw `fetch` calls**; 182 manual `data.data` unwraps;
  113 files hand-roll a failed/stale split; **47 of 146 `useApiQuery` consumers
  have no stale/placeholder handling**. Three examples render failure as empty:
  `assignment-config.tsx:45-48`, `saved-views.tsx:45-48`, `record-picker.tsx:87-92`.
- Server components swallow to empty: 7 `.catch(() => [])` page reads,
  362 `?? []` fallbacks; the catch guard only scans `route.ts`, not pages.

**Highest-leverage fix.** One discriminated `Result<T,E>` for domain helpers; one
`{ok:true,data}` / `{ok:false,error:{code,message}}` envelope with `ok()/fail()`;
one browser client that unwraps and throws `ApiError`; one `useApiQuery` wrapper
returning `{state:'loading'|'ok'|'stale'|'failed'}`. Ban raw `fetch` and ignored
results by lint.

---

### H5 — Denormalised counters and quotas

**Root cause.** The same fact is stored twice: hand-maintained columns and a
derive-on-read implementation used by quota checks. No counter has a single
owner, no trigger maintains it, and no job reconciles it.

**Evidence**

- `tenants.currentContacts` has 12 SET sites in 12 files; **at least 6 insert/
  delete paths never touch it** (v1 contacts, inbound webhook, chat, contact
  resolver, superadmin user-data). Imported leads increment it; `POST /leads`
  does not.
- `sequences.enrollCount` has 5 increment sites and **0 decrements**.
- `tenants.storageUsedBytes` is written by `files/` but not `documents/`, while
  the meter sums both.
- Quota checks read a derived count **before** the insert transaction
  (`lib/usage/middleware.ts:45` → `contacts/route.ts:201`), a READ COMMITTED
  TOCTOU race. Only three importer paths lock in-tx.
- **No counter triggers** (the only trigger is audit immutability), **no DB limit
  CHECK**, **no repair job**.
- `scripts/check-counter-increments.mjs` scans one line at a time in `app/api`
  only, so it cannot see missing writes, decrements, `lib/`, or raw SQL.

**Highest-leverage fix.** Let the database own the counters: `AFTER INSERT/
UPDATE OF deleted_at/DELETE` triggers per child table, a nightly
`reconcile_counters` job that recomputes and alerts, and quota admission inside
the insert transaction (`SELECT … FOR UPDATE` on `tenants`). Alternatively drop
the columns and derive everywhere — but that is a wider UI change.

---

### H6 — Enforcement drift (guards and citation churn)

**Root cause.** Architectural rules are enforced by bespoke text matching, and
architecture claims are pinned to line numbers. Both rot mechanically.

**Evidence**

- **37 guard scripts over 37 distinct files, 11,372 lines, zero TypeScript ASTs**,
  five negative controls. Twelve route-semantics guards have >50% false-negative risk
  under refactoring: `export { POST } from './_impl'` evades CSRF; a `db` call hidden
  in `lib/` evades the RLS guard; an `error.tsx` that returns `null` satisfies
  the boundary guard.
- **The gate an agent is told to run is not the gate that gates.**
  `scripts/pre-merge-check.sh` has eight steps and invokes **4 of the 37** guards
  (`rollback-coverage`, `seed-credential`, `destructive-gate`, `cron-auth`);
  a comment inside that very file records that `guard:migration-redecl` "has no step in
  pre-merge-check.sh" (cited by text, not by line number — the line it was on has
  already drifted by four). It is referenced by **no workflow**.
  Wiring, it turns out, is *not* the problem — and the audit's first draft of this
  bullet got that wrong. Measured properly, `.github/workflows/ci.yml` covers
  **33 of 37** — 30 by `npm run guard:*` alias plus **3 invoked as bare
  `node scripts/…`** (`audit`, `semgrep`, `env-coverage`) — `nightly-soak.yml` adds
  3 more (`catalog-grants`, `register-drift`, `running-config`), so **36 of 37 run in
  some workflow** and exactly one, `guard:migration-redecl`, runs nowhere. The reason
  every document (including `docs/README.md`) keeps disagreeing about this is the
  measurement, not the estate: grepping `npm run guard:[a-z-]+` **cannot see a bare
  invocation**, so it reports 30 and "four unwired". This author made that exact error
  on 2026-11-01 and printed it into four files. So the real defect is not coverage but
  visibility: 33 text-matching guards can be satisfied by code they cannot see (bullet
  above), and the census itself is ungrepable. No pre-push hook; pre-commit only runs
  gitleaks, and `lint-staged` is unconfigured (a no-op).
- **The estate moves under the documents that count it.** This section said "35
  guard scripts, 12,619 lines, pre-merge runs 3"; re-measured on `main` on
  2026-10-31 it was 36 / 10,921 / 4-wired-locally, and on 2026-11-01 it is
  37 / 11,372 / 4. `guard:pm-log-paths` and `guard:env-coverage` were added in
  that window. Any count quoted in prose is stale within a week — which is the
  same defect as the line-number citations below, and why **#3399** keeps
  re-opening. Cite a command, not a number; and when the command is a census, it must
  match bare invocations too, or it is not a census.
- **Citation churn**: `docs/infra/PREPROD-ISSUE-REGISTER.md` is 5,790 lines with
  **511 `path:line` citations** (`grep -ohE '[A-Za-z0-9_./-]+\.(ts|tsx|mts|cjs|mjs|json|sql|yml|md|sh)(:[0-9]+)+' … | wc -l`;
  this section said 5,502 lines / 479 citations / 471 line-numbered on 2026-10-31 and
  #3436 alone added 161 lines since). In six weeks it took **216 commits
  (~4.9/day)**, of which **55 (25%) are pure re-pins**; all-time 77 re-pin
  commits. Keyed pointers (e.g. `package.json:"script"`) generated zero re-pins.
- Baselines are writable by the PR they gate: the file-size baseline's total
  ceiling **increased by 174 lines** in this cycle.

**Highest-leverage fix.**
1. Cut 37 → ~12: keep the structural ones (`vocab`, `chain`,
   `rollback-coverage`, `destructive-gate`, `running-config`, `audit`,
   `semgrep`); replace route-semantics regexes with types and
   `no-restricted-imports`/ESLint.
2. Cite **symbols**, not line numbers (`path#exportName`, `path#"key"`, heading
   anchors). Run drift detection in PR CI; have nightly open an issue instead of
   a re-pin PR. This removes ~470 positional anchors and the 25% tax.
3. Ship **one** census command that resolves every `guard:*` alias to its script
   file and searches every workflow for that *file*, not for `npm run <alias>`, and
   have `docs/README.md` and this report quote that command rather than its output.
   Two of the three wiring numbers in this section's history were wrong because the
   easy grep cannot see a bare invocation; the fix is the command, not a corrected
   number.

---

### H7 — Scheduled work has three owners and no proof it ran

**Root cause.** A schedule is data written three times in three notations
(`crontab`, `vercel.json`, a TypeScript array), and nothing at runtime proves a
job executed. The guard checks that scheduled **names** have routes; the health
endpoint checks **records** of jobs that already ran. Neither can see a job that
is scheduled nowhere.

**Evidence** (computed from the three source files; command in §8)

| Source | Jobs | Missing routes |
| --- | --- | --- |
| `deploy/cron/crontab` (production / pm2 VM) | 17 | `backup`, `lead-warming`, `process-lead-scoring`, **`recurring-invoice-generator`**, `sla-check` |
| `vercel.json` | 18 | `backup`, `lead-warming`, `process-lead-scoring`, `sla-check` |
| `scripts/cron-scheduler.ts` (in-process) | 18 | `process-lead-scoring`, `sla-check`, `scheduled-report-delivery`, `subscription-renewal-check` |

- **Two routes are scheduled by nothing at all**: `process-lead-scoring`
  ("nightly recompute") and `sla-check` ("runs periodically, e.g. every 5–10
  minutes"). Both routes exist, authenticate, lock, and sweep tenants — they
  simply never fire.
- **Both production shapes read the same `deploy/cron/crontab`**: the Docker
  cron service mounts it (`deploy/docker-compose.production.yml:281-286`) and
  the pm2 VM installs it as the host crontab. That file omits
  `recurring-invoice-generator`, so recurring invoices are not generated in
  production, and omits `lead-warming`, so daily warming campaigns do not run
  there. `subscription-renewal-check` and `scheduled-report-delivery` *are* in
  the crontab but *not* in the in-process scheduler.
- **The guard certifies the gap.** `scripts/check-cron-lock.mjs` keeps a
  five-name `UNSCHEDULED_IN_CRONTAB` set described in its own comment as
  "tracked debt awaiting an owner decision"; rule 4 fails only when that set
  changes in the wrong direction, and rule 5 downgrades source divergence to a
  **note**. The guard is green today with revenue and SLA jobs dark.
- **The dead-man switch cannot see them.** `/api/system/cron-health` reads
  `lib/cron/health.ts`, an **in-memory** `Map`. `registerCronRun` is called by
  **0 of 22** cron routes (only tests call it), the map is per-process, and it is
  empty after every restart. `getCronHealth()` therefore returns `[]` and the
  endpoint answers `{"status":"healthy","totalJobs":0,"staleCount":0}` — for a
  fleet whose cron has never run.
- **The in-process scheduler aborts long jobs.** `scripts/cron-scheduler.ts:68`
  uses `AbortSignal.timeout(120_000)`, while the `backup` job it schedules calls
  `pg_dump` with a `timeout: 600_000` (`lib/backups/backup-service.ts:217`).

**Highest-leverage fix.**
1. One manifest (`lib/cron/jobs.ts`) with `{ name, path, cron, owner,
   maxDurationMs, expectedEveryMs }`; generate `crontab`, `vercel.json` and the
   tsx scheduler from it, or assert exact equality in CI. Divergence stops being
   a note and becomes a red build.
2. Persist `cron_runs` in Postgres from the shared lock wrapper (one write per
   run, success or failure) and make `/api/system/cron-health` compare the
   **manifest** to the last success. Report `never_run` as loudly as `stale`.
3. Schedule or delete the five orphans; `recurring-invoice-generator` first, and
   `sla-check` at the interval its header already claims.

---

### H8 — Background jobs fall back to a queue nobody consumes

**Root cause.** The producer and the consumer choose their backend
independently. The producer auto-negotiates Redis → pg-boss → memory and caches
the winner for the process lifetime; the only consumers in the repo are BullMQ
workers.

**Evidence**

- `lib/queue/index.ts:53-95` selects a provider per process. If Redis fails the
  first `ping`, it constructs a **pg-boss** adapter and stores it in module-level
  `adapter`, which returns early on every later call — a transient Redis blip
  pins the whole process to pg-boss.
- `worker.ts` starts ten BullMQ `Worker`s and **nothing else**. There is no
  `boss.work(...)`, `PgBoss` consumer, or scheduler for pg-boss anywhere in the
  repo (`grep` in §8).
- The in-memory adapter does not execute jobs; it logs `DISCARDING job …`.
- The production safety net is unreachable: the code throws only when **no**
  provider is available, but `DATABASE_URL` is always set, so the pg-boss branch
  always succeeds. The throw at `lib/queue/index.ts:85-90` protects a state that
  cannot occur in production.
- Producer/consumer asymmetry across the 10 declared job types: **7** are
  produced by `addJob` call sites; **10** have workers; `send-notification`,
  `run-automation` and `webhooks` have a consumer and **no producer** (webhooks
  are written to `webhook_deliveries` and delivered inline instead).

**Concrete failure.** `app/api/tenant/email/bulk/route.ts:103` awaits
`addJob('send-bulk-emails', …)` and then returns "Queued N emails". If the
process selected pg-boss, the call succeeds and the campaign is never sent:
the API, the audit log, and the UI all report success; only the recipient's
inbox disagrees.

**Highest-leverage fix.**
1. Delete the pg-boss and memory fallbacks. One backend (Redis/BullMQ), one
   failure mode: `addJob` throws, and the route tells the user.
2. Replace the three duplicated job-type lists (`JobType`, the two adapter
   arrays, `QUEUE_NAMES` in `worker.ts`) with one registry that declares a
   producer **and** a consumer for each type; a type with only one of the two
   fails a unit test.
3. Make worker health part of the same check: `/api/system/worker-health` should
   fail when the heartbeat is missing, not just report it.

---

### H9 — Authorization is a configurable control plane with partial enforcement

**Root cause.** There are **four** authorization mechanisms — `requirePerm` /
`can`, ad-hoc `ctx.isAdmin`, `field_permissions` (via `lib/rbac/enforce.ts`),
and `record_permissions` — and no rule about which handler must call which. The
admin UI presents one of them as *the* permission model, so the gap between
what the UI promises and what the request path checks is invisible to the
operator.

**Evidence** (all counts from `app/api`, §8 commands)

- **66 of 248 mutating tenant routes** (`POST`/`PATCH`/`PUT`/`DELETE`) contain
  no permission check at all — only `requireAuth` (and sometimes CSRF). These
  are **not** unauthenticated routes: every one is authenticated and
  tenant-scoped, and a few substitute a different gate (`plugin-engine`
  requires `authMethod === 'api_key'`). What is missing is the *role* layer:
  nothing asks whether the caller's role is allowed to do this. The
  set includes `invoices/route.ts` (create invoice), `invoices/[id]/send`,
  `products/route.ts`, `products/[id]`, `services/*`, `contracts`,
  `subscriptions`, `territories`, `webhooks/field-mappings`,
  `kb/*`, `email-templates/*`, `documents/[id]` (delete) and
  `custom-entities/[id]/rows/*`. A user on the seeded `member` role can create
  an invoice, send it to a customer, create a product, or delete a document;
  RLS only stops them doing it to *another tenant*.
- **The catalog and the checks are different vocabularies.**
  `lib/permissions/definitions.ts` defines **66** ids and is what
  `app/tenant/settings/roles/page.tsx` renders. Routes check **74** distinct
  strings via `can`/`requirePerm`/`ownerScope`. **21** checked strings are not
  in the catalog — a new role cannot be granted them through the UI, so those
  routes are effectively `admin`-only (`companies.view`, `deals.export`,
  `meetings.view`, `calendar.manage`, `projects.*`, `partners.create`,
  `quotes.edit/delete`, `subscriptions.edit/delete`, …). Conversely **16**
  catalog ids are checked **nowhere** — including `invoices.create`,
  `invoices.send`, `contracts.create`, `contracts.sign`, `billing.manage`,
  `deals.view_value`, and `team.manage_roles`. The UI advertises controls the
  server never reads.
- **`record_permissions` is dead code.** `lib/rbac/record-permissions.ts`
  exports `checkRecordAccess`, `getRecordAccessFilter`, `grantRecordAccess` and
  `revokeRecordAccess`; **none** is imported by a production module (§8). The
  only reader of the table is the settings list route
  (`app/api/tenant/rbac/record-permissions/route.ts`), so rows can be created
  and expired and change nothing. Row-level "this rep sees only their deals"
  is enforced instead by a per-handler convention: `deals/route.ts:56`,
  `leads/route.ts:90` and `tasks/route.ts:38` each re-implement
  `can(ctx, '<entity>.view_all')`, `contacts/route.ts:29` re-implements it
  again with a raw permissions lookup, and `companies/route.ts` has **no**
  owner filter at all — every member sees every company.
- **Field permissions cover a fifth of the read surface, and the same tables
  are readable around them.** `enforceFieldRead/Write` appear in **98 call sites in
  30 of 326** tenant route files (re-derive with
  `git grep -l -E 'enforceFieldRead|enforceFieldWrite' -- 'app/api/tenant/**/route.ts' | wc -l`) —
  every one of them a CRUD/import/export
  handler for exactly five entities (`leads`, `contacts`, `deals`, `tasks`,
  `companies`). The alternative readers of those same tables are unhooked:
  `data-explorer` raw-SELECTs `d.amount` (`app/api/tenant/data-explorer/route.ts:161`),
  `search/advanced` returns `amount` (`route.ts:221`), and `history/[entity]`
  replays column diffs. A role with `deals.amount` set to `none` still learns
  every deal value by searching.
- **`isAdmin` is a role *slug*, not a permission.** `can()` short-circuits to
  `true` for `ctx.isAdmin`, which `requireAuth` computes as
  `roleSlug === 'admin' || isSuperAdmin`. A tenant that renames or recreates
  its admin role (the UI creates arbitrary slugs) silently loses the bypass,
  and a role that *should* be admin-like cannot obtain it — while 86 route
  files gate on `ctx.isAdmin` directly instead of a permission.
- **The catalog's own `checkPermission` has zero callers.** The module exports
  the catalogue, `DEFAULT_ROLE_PERMISSIONS`, `checkPermission` and
  `getPermissionsDiff`; only the array is imported (by three UI pages), and
  the seeded role maps in `scripts/seed-dev.ts` / `scripts/seed-fresh.ts` are
  written by hand and do not match it.

**Concrete failure.** A tenant admin creates a `finance` role in Settings →
Roles, ticks every box (66/66), and assigns it to a bookkeeper. The bookkeeper
can open the invoice list but the invoice `POST` and `send` routes have no
permission check, so the role is irrelevant there; meanwhile the same role
cannot be granted `subscriptions.edit` (checked by a route, absent from the
catalog), so a control the admin believes they assigned is denied at runtime
with a 403 that names a permission they have never seen.

**Second concrete failure.** An admin hides `amount` from the `rep` role in
Settings → Field permissions. `GET /api/tenant/deals` and the deals detail
route strip it. `GET /api/tenant/search/advanced?type=deals` and
`GET /api/tenant/data-explorer?type=deals` — the two panels the rep actually
uses to browse — return it, because neither imports `lib/rbac/enforce`. The
setting's own UI shows the row as saved.

**Highest-leverage fix.**
1. One `authorize(ctx, entity, action)` helper backed by a single
   `entity × action → permission-id` map, and make **every** mutating handler
   call it. Derive the map from the catalog so the two vocabularies cannot
   diverge; add the missing ids (`*.view`, `*.export`, `*.assign`,
   `projects.*`, `subscriptions.edit`, …) and delete unused ones.
2. Add a guard (AST-based, per H6) that fails when a `POST`/`PATCH`/`DELETE`
   handler under `app/api/tenant` has no `authorize` call and is not on an
   explicit self-scoped allowlist (`/me`, `notifications`, `2fa`, `onboarding`).
3. Either enforce `record_permissions` in the list/detail handlers (one
   `getRecordAccessFilter` call per entity query, as the module was designed
   for) or delete the table and its settings UI. Today it is the
   `field_permissions` bug of #2597 waiting to be reported again.
4. Stop treating `roleSlug === 'admin'` as a permission; make `admin` a real
   catalog permission so renamed roles behave.

---

## 4. In-flight branch `#3381` review

The working tree is uncommitted (`git diff main...HEAD` is empty; 14 modified +
4 new files). The fix itself is sound — one TLS policy in
`lib/db/ssl-config.ts` and a shrink-only guard. Defects found:

| # | Severity | Finding |
| --- | --- | --- |
| B1 | High | `scripts/restore-db.ts:52-53` imports `pgSslConfig` **twice**. `tsc` reports `TS2300: Duplicate identifier 'pgSslConfig'` (verified). CI misses it because `tsconfig.json:38` excludes `scripts/**`; `tsx` tolerates it at runtime. |
| B2 | High | The new policy defaults to TLS (`DATABASE_SSL !== 'false'`), but the root compose runs Postgres **without** TLS while defaulting `DATABASE_SSL=true` (`docker-compose.yml:128`). Local dev and any script that does not load `.env` (`drop-all.ts`, `verify-migration-chain.ts`) will fail the handshake unless `DATABASE_SSL=false` is set. CI masks this (`ci.yml:20`). |
| B3 | High | `ecosystem.config.cjs:108,150,185` hardcodes `DATABASE_SSL_REJECT_UNAUTHORIZED='false'` for web, worker and cron — so the production VM has TLS but **no certificate verification**, contradicting the policy's "verify in production". The guard does not inspect pm2 env. |
| B4 | Medium | `check-pool-tls-policy.mts` scans only `.ts/.mts`; `scripts/provision-app-role.mjs` still opens an unchecked pool. `pg_dump`/`pg_restore` use libpq `sslmode`, outside the policy. |
| B5 | Medium | The production compose image runs `prod:start:custom`, which binds **`127.0.0.1`** (`package.json`), while nginx proxies `app:3000`. Preprod overrides the command; production does not. |
| B6 | Medium | `.env.example` sets `PGBOUNCER_ENABLED=true` while pointing at a direct `:5432` URL. If used as-is, the app skips its own GUC release-reset because it believes a pooler is doing it — the cross-tenant leak ADR-0003 warns about. |
| B7 | Medium | `deploy.sh` brings the stack **up** then runs `drizzle-kit push` with `|| warn`, so a failed migration still reports success — contrary to the repo's own "`db:migrate`, not `db:push`" rule. |

**Recommendation:** fix B1 and B2 before opening the PR; file B3–B7 as separate
issues under the "one issue per PR" policy.

---

## 5. Cross-cutting design smells

- **Three admin namespaces and two API generations.** `app/api/superadmin` (55
  routes), `super-admin` (16), `admin` (3); `v1` (11) and `v2` (2).
- **`v2` is not a version — it is a loopback proxy.** `app/api/v2/[...path]`
  re-enters the app over HTTP to `/api/tenant/*`, copying cookies/authorization
  and re-running `proxy.ts`. That doubles auth and rate-limit work and makes the
  public contract depend on internal routing.
- **34 raw `new Pool(` sites.** The new guard now enumerates 30 of them; the
  structural fix is a single `createPgPool()` factory so a policy change is one
  edit, not 30.
- **Two queue technologies, one consumer.** `lib/queue/index.ts` advertises
  BullMQ, pg-boss and an in-memory backend; only BullMQ is consumed (#401, H8).
- **Three cron dialects.** `crontab`, `vercel.json` and a TypeScript array are
  kept in sync by a guard that permits divergence (H7).
- **Doc drift and ADR collisions.** `docs/adr/` has **two ADRs each numbered
  0001–0006** and another 0011. `ARCHITECTURE.md` says 507 endpoints (code: 519)
  and 224 tables (code: 226); `PROJECT_MAP.md` says "pm2 in production" while this
  host runs Docker. RLS "FORCE is off" is false for 13 tables.
- **Repository leftovers.** `archive/`, `futureplan/`, `comm/`,
  `test-benchmark.js`, `benchmark-array-vs-map.ts`, `verify-schema.ts` at root.
- **Unauthenticated echo** at `app/api/test` (harmless, but it is a production
  surface with no purpose).

---

## 6. What is genuinely healthy

Worth saying explicitly, because it changes the remediation strategy: the team
is not cutting corners, so the fixes below should be **structural**, not more
review discipline.

- 0 `TODO`/`FIXME`/`HACK`, 0 `@ts-ignore`, 6 `as any`, 3 `eslint-disable`,
  2 skipped tests across 1,038 test files.
- Real ADRs (16) with alternatives considered, including the honest ADR-0003
  post-mortem on the GUC bug.
- 146 migrations, each with a `.down.sql`, and a rollback guard that runs them.
- Structured JSON logs with request IDs, Sentry with PII scrubbing and release
  pinning, liveness vs readiness split, SSRF guard (`safeFetch`), CSRF, rate
  limits, HMAC webhook verification, dependency overrides with a semver guard.
- **Cron auth and refusal semantics are shared, not copied**: 22/22 routes call
  `verifyCronSecret` with a job name, and 20/22 take their dedup lock through
  `lib/cron/cron-lock.ts` (the other two hold the lock to re-run immediately);
  a skipped run is `423 { ok: false }`, not `200 { skipped: true }`.
- **Money is treated as a ledger**: `invoice_payments` is append-only and
  `amount_paid` / `balance_due` / `status` are recomputed from it inside the
  same transaction (`lib/billing/payments.ts`); AI credits use a CAS
  reservation (`reserveCredits`) rather than a read-then-act gate.
- **Realtime rooms are derived from the verified cookie**, not from client
  input (`lib/realtime/handshake.ts`), so a socket cannot subscribe to another
  tenant's room by asking.
- The new pool-TLS guard passes on the tree: **30 Pool sites across 1,130 files**.
- **Every tenant-configurable outbound URL goes through one guard.** The plugin
  engine's `baseUrl` and OAuth `tokenUrl` (`lib/plugins/engine.ts:107,191,280`),
  the AI gateway's `baseUrl` (`lib/ai/gateway.ts:197,268`) and OIDC discovery
  (`lib/auth/sso/oidc.ts:81,166`) all call `safeFetch`/`assertSafeUrl`, so
  stored integration keys cannot be redirected at the metadata endpoint — and
  there is no `eval`/`new Function`/`node:vm` anywhere in `app` or `lib`, so the
  plugin surface is data-driven, not code-executing.

---

## 7. Prioritised roadmap

Ordered so that each step removes a *class* of bug, and each maps to a
reviewable, single-issue PR.

| Priority | Work | Closes | Effort |
| --- | --- | --- | --- |
| **P0.1** | Make pool mode an invariant: session mode in `.ini` + all compose, boot assertion on `SHOW pool_mode`, correct ADR-0003 — ✅ declared half + ADR + guard landed in PR #3445; 🚧 boot assertion and the `guard:running-config` declared-vs-live diff still open | H1 | S |
| **P0.2** | Give the four context-free webhooks an explicit system context; test them under FORCE RLS — ✅ contexts landed (#3246 + #3436); 🚧 the FORCE-RLS read-back exists only for razorpay/stripe/resend, not for payu/whatsapp | H1 | S |
| **P0.3** | Fix B1 + B2 in the #3381 branch before merge | §4 | XS |
| **P0.4** | Add `deleted_at IS NULL` to the forgot/reset-password user lookup; test that a tombstoned user cannot reset | H2 | XS |
| **P1.1** | `withTenantDb`/`withSystemDb` + branded types + ban raw client imports | H1 | L |
| **P1.2** | `transitionStatus()` + transition registry + CAS in `WHERE` | H3 | M |
| **P1.3** | One `Result<T,E>`, one envelope, one typed client, one query-state hook | H4 | L |
| **P1.4** | Counter triggers + reconcile job + in-tx quota | H5 | M |
| **P1.5** | Tombstone in every RLS policy + partial unique indexes + `live()` helper; widen the guard | H2 | M |
| **P1.6** | One cron manifest generating all three schedules; persisted `cron_runs` + a health check that reports `never_run`; schedule or delete the five orphans | H7 | M |
| **P1.7** | Remove the pg-boss/memory fallbacks; one job registry requiring a producer and a consumer per type | H8 | S |
| **P1.8** | One `authorize(entity, action)` map derived from the permission catalog; gate the 66 ungated mutating routes; enforce or delete `record_permissions` | H9 | M |
| **P2.1** | Cut guards 37 → ~12; add AST-based checks for the route rules | H6 | M |
| **P2.2** | Symbol-keyed citations; run drift in PR CI; nightly issue instead of re-pin PR | H6 | S |
| **P2.3** | Consolidate `superadmin`/`super-admin`/`admin`; make `v2` a real route set | §5 | M |
| **P2.4** | One `createPgPool()` factory; ban `new Pool(` | §5 | S |
| **P3** | Doc drift, ADR renumbering, repo cleanup, remove `/api/test` | §5 | S |

---

## 8. Appendix — reproduce the evidence

```bash
# inventory — every answer below was re-run on origin/main on 2026-11-03
find app -name 'route.ts' | wc -l                      # 519
grep -rl withApiRoute app/api | wc -l                  # 423 files mention it
grep -rl "@/drizzle/db" app lib components | wc -l     # 530
grep -rho 'pgTable(' drizzle/schema | wc -l            # 226
grep -rhoE '\.\.\.utils\.(audit|lifecycle)\(\)' drizzle/schema/*.ts | wc -l  # 199
node -pe "require('./drizzle/migrations/meta/_journal.json').entries.length" # 146
ls drizzle/schema/*.ts | wc -l                         # 46 direct; 63 with registry/
find app -name 'page.tsx' | wc -l                      # 231 (grep 'page.tsx$' over
                                                       # paths answers 232: client-page.tsx is not a page)

# the pooling contradiction
grep -rn "POOL_MODE" docker-compose.yml deploy/*.yml   # transaction vs session
grep -n "pool_mode\|server_reset_query" deploy/pgbouncer/pgbouncer.ini

# context-free webhooks (re-measured: razorpay+stripe were wrapped by #3436)
for r in razorpay stripe whatsapp payu inbound resend telegram/bot; do
  f=app/api/webhooks/$r/route.ts; [ -e "$f" ] && printf "%-11s ctx=%s writes=%s\n" "$r" \
    "$(grep -cE 'withApiRoute|withSystemContext|withBillingWebhookContext|set_config|app\.current' "$f")" \
    "$(grep -cE '\.insert\(|\.update\(|\.delete\(|\.execute\(' "$f")"
done                                                       # whatsapp/payu/resend: ctx=0
#   OUTPUT WRONG, RE-MEASURED 2026-11-03 on `84ae3767`: all three are covered. The
#   alternation never listed `withTenantScope`/`withTenantContext`, which is what
#   payu (`route.ts:64` → `:156`), resend (`route.ts:85`) and
#   lib/whatsapp/webhook-processor.ts (`:101`, `:213`) actually call; and `\.update\(`
#   matches `createHmac().update(rawBody)`, so `whatsapp writes=1` counted a signature
#   over a route with no DB statement in it — its write lives one import away. Pinned
#   by tests/unit/{payu,resend-webhook-tenant-adoption,whatsapp}-*-3246.test.ts (97
#   passed). The finding that survives is the one this loop demonstrates: a per-file
#   grep cannot enforce an invariant whose fulfilment crosses files. See FIX-PLAN §3
#   PR-1B and PR-1C.

# lifecycle — method matters: a line-anchored grep sees 57, the same rule over
# multi-line .set() bodies sees 123. Quote which one you ran.
grep -rn "\.set({ *status" app lib | wc -l                           # 57 (single line)
grep -rzoE "\.set\(\{[^}]{0,200}status" app lib | tr -cd '\0' | wc -c  # 123 (any layout)
grep -rn "pgEnum" drizzle | wc -l                      # 0

# the duplicate import — FIXED by #3430; keep as a negative control on a scratch file
grep -n "pgSslConfig" scripts/restore-db.ts            # one import (line 47)
npm run typecheck                                      # now covers scripts/** too

# guard + citation estate — the census MUST resolve aliases to script files, because
# three guards are invoked as bare `node scripts/…` and are invisible to the naive grep
node -e "const p=require('./package.json');console.log(Object.keys(p.scripts).filter(k=>k.startsWith('guard:')).length)"   # 37 on 2026-11-03; 38 since #3404 wired guard:pool-mode
node -e 'const fs=require("fs"),p=require("./package.json");
 const g=Object.entries(p.scripts).filter(([k])=>k.startsWith("guard:"));
 const wfs=fs.readdirSync(".github/workflows").filter(f=>f.endsWith(".yml"));
 const text=wfs.map(f=>["workflows/"+f,fs.readFileSync(".github/workflows/"+f,"utf8").split("\n").filter(l=>!/^\s*#/.test(l)).join("\n")]);
 const wired=new Set(); for(const [k,v] of g){const m=v.match(/scripts\/[\w./-]+\.(mjs|cjs|ts|mts|js)/);
   for(const [f,t] of text) if(t.includes("npm run "+k)||(m&&t.includes(m[0]))) wired.add(k);}
 console.log("wired",wired.size,"of",g.length,"| unwired:",g.map(([k])=>k).filter(k=>!wired.has(k)).join(", "));'
# → wired 36 of 37 | unwired: guard:migration-redecl   (ci.yml alone covers 33)
#   re-run 2026-11-03 after #3404: wired 37 of 38, same single unwired alias, ci.yml 34
grep -c ':[0-9]\+' docs/infra/PREPROD-ISSUE-REGISTER.md   # 747 lines carry a :<digits>
                                                       # (not 511 citations either — H6 has the pattern that counts them)

# scheduled-work matrix (H7)
python3 - <<'PY'
import json, re, os
routes = sorted(os.listdir('app/api/cron'))
crontab = [l.split()[-1] for l in open('deploy/cron/crontab')
           if l.strip() and not l.lstrip().startswith('#') and 'run-cron.sh' in l]
vercel = [c['path'].split('/')[-1] for c in json.load(open('vercel.json'))['crons']]
sched = list(dict.fromkeys(re.findall(r"name:\s*'([a-z0-9-]+)'", open('scripts/cron-scheduler.ts').read())))
for label, jobs in [('crontab', crontab), ('vercel', vercel), ('scheduler', sched)]:
    print(label, len(jobs), 'missing:', sorted(set(routes) - set(jobs)))
print('in no source:', sorted(set(routes) - set(crontab) - set(vercel) - set(sched)))
PY
node scripts/check-cron-lock.mjs        # green while two routes are unscheduled
grep -rn "registerCronRun" app | wc -l  # 0 — the health registry has no writer

# background delivery (H8)
grep -c "new Worker(" worker.ts                          # 10 BullMQ consumers
grep -rn "boss.work\|\.work(" --include=*.ts lib app worker.ts | wc -l  # 0 pg-boss consumers
grep -rn "addJob(" --include=*.ts lib app | grep -v 'lib/queue/index.ts' | wc -l  # 8 producer call sites

# authorization coverage (H9)
grep -rlE "export const (POST|PATCH|PUT|DELETE)" --include=route.ts app/api/tenant | wc -l  # 248
comm -23 <(grep -rlE "export const (POST|PATCH|PUT|DELETE)" --include=route.ts app/api/tenant | sort) \
         <(grep -rlE "can\(ctx|requirePerm\(|ctx\.isAdmin" --include=*.ts app/api/tenant | sort) | wc -l  # 66
# catalog vs checked vocabulary
grep -oE "id: '[^']+'" lib/permissions/definitions.ts | sed "s/id: '//;s/'//" | sort -u > /tmp/defined
grep -rhoE "(can|requirePerm|ownerScope)\((ctx, )?['\`][^'\`]+" --include=*.ts app/api \
  | sed -E "s/.*['\`]//" | sort -u > /tmp/used
comm -23 /tmp/used /tmp/defined   # 21 checked ids a new role cannot be granted
comm -13 /tmp/used /tmp/defined   # 16 catalog ids no route reads
grep -rn "rbac/record-permissions" --include=*.ts app lib | grep -v "app/api/tenant/rbac/" # 0 importers
grep -rn "enforceFieldRead\|enforceFieldWrite" --include=*.ts app lib | grep -v "lib/rbac/enforce.ts" | wc -l  # 87 in 30 files
grep -rn "companies.view_all" app/api/tenant/companies/route.ts | wc -l  # 0 — every member sees every company
```

> Line numbers cited here are current as of 2026-10-31 and will drift. That is
> finding H6; the fix for the finding also fixes the fragility of this document.

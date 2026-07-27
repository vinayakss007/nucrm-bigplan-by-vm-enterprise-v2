# Open issue triage

All 20 open issues, mapped to the work that addresses them and the evidence behind each claim.

Verified against the repo at the tip of `fix/api-envelope-and-a11y`. Counts in the original issue
bodies have drifted; where a number here disagrees with the issue, the number here was measured.

## Summary

| #   | Title (abbrev.)                       | State                           | Where                                                |
| --- | ------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| 52  | Epic: enterprise infrastructure       | partial                         | pre-existing CI/PgBouncer/metrics; core gaps open    |
| 422 | 25+ files exceed 500 lines            | open                            | partly stale                                         |
| 638 | 5 files exceeding 1000 lines          | open                            | partly stale                                         |
| 640 | Rollback scripts for 38 migrations    | partial                         | #737, #738 — and DOWN files are currently unrunnable |
| 641 | Raise coverage threshold 60%→70%      | **numeric part already done**   | thresholds are 70/70/80/70 on `main`                 |
| 642 | RLS + PgBouncer interaction           | partial + **premise corrected** | #737; real bug proven below                          |
| 643 | Consolidate dual error handling       | open                            | untouched                                            |
| 644 | Replace SSE with WebSocket            | open                            | untouched                                            |
| 645 | Adopt ADR process                     | open                            | untouched                                            |
| 654 | 126 pages missing loading/error.tsx   | **fixed**                       | this branch                                          |
| 655 | API format + accessibility gaps       | partial (3 of 7 sub-items)      | #739, #740                                           |
| 668 | Epic: Phase 1 test coverage           | **effectively done**            | pre-existing                                         |
| 669 | Epic: Phase 2 SDK resource tests      | substantially done              | pre-existing                                         |
| 670 | Epic: Phase 3 DB-mocked service tests | open                            | not assessed                                         |
| 671 | Epic: Phase 4 tenant context & auth   | open                            | not assessed                                         |
| 672 | Epic: Phase 5 automation & calendar   | open                            | not assessed                                         |
| 674 | Epic: database fail-proof layer       | partial                         | #737                                                 |
| 675 | Epic: automated encrypted backup      | partial                         | this branch                                          |
| 676 | Epic: corruption-free data handling   | partial                         | #733, #735                                           |
| 688 | Agent task division — 48 open issues  | **stale, needs closing**        | see below                                            |

All of this work now lives in **one branch**, `integration/enterprise-hardening`, as nine commits.
It replaces the earlier stack of PRs #735, #736, #737, #738, #739, #740 and #741, which became
unmergeable: each child PR had been merged _down into its own base branch_ instead of the base
being merged up into `main`, so the bottom of the stack accumulated everything and conflicted with
`main`. Close those seven in favour of the single PR.

---

## `main` is red again, and that is how #733 shipped broken

Measured by reconstructing `main`'s tree (`3f2ed03f`) from the GitHub API and typechecking it:

```
main alone                          175 typecheck errors
  of which pre-existing (utils.ts)  158   <- fixed by the first commit in this branch
  of which introduced by #733        17   <- fixed by a new commit in this branch
main + this branch                    0
```

Two of the 17 are runtime faults, not type noise:

- **`PATCH /api/tenant/deals/:id` was completely broken.** The refactor renamed `body` to the
  validated payload but left twelve `body.stageId` references, so every request threw a
  `ReferenceError` and returned 500. Deal updates — the thing issues #658 and #660 were about —
  regressed silently.
- **`cron/process-sequences`** referenced `body` after it became `emailBody`, so any sequence step
  that sends an email threw before sending.

The same PATCH also spread the validated body into the `SET` clause, which put snake_case keys
(`stage_id`, `contact_id`, `company_id`, `pipeline_id`, `assigned_to`, `close_date`) and
request-only keys (`value`, `stage`, `stage_name`) into the update. None are columns on `deals`, so
those fields never persisted; they are now mapped explicitly.

The systemic point: **once a gate is red, new breakage is invisible.** `main` already had 158
typecheck errors, so #733 adding 17 more changed nothing observable and it merged. Keeping the
gates green is what makes the next regression detectable — which is the argument for landing this
branch as one unit rather than leaving it stacked and unmergeable.

---

## Fixed

### #654 — loading.tsx / error.tsx coverage

Every one of the 200+ pages is now covered by both a loading and an error boundary.

The issue's counts were derived per-directory, which overstated the work. Both boundary kinds
cascade to descendants that don't define their own, so five files at the segment roots closed the
whole gap. Error coverage was already effectively complete for the same reason; the real gap was
loading states.

`tests/unit/route-boundaries.test.ts` asserts coverage **by ancestry** so the fix can't silently
regress. HG-22 (`useSearchParams` without Suspense) is also fixed — only `app/tenant/search` was
actually affected.

---

## Partially addressed

### #642 — RLS + PgBouncer: the issue describes the wrong failure mode

The issue asks whether `set_config('app.current_tenant', …, is_local=true)` **leaks between
tenants** under PgBouncer transaction mode. It does not. The opposite happens, and it is worse.

`is_local=true` scopes the setting to the current transaction. Every production caller of
`setTenantContext` passes no transaction — 6 call sites in `lib/auth/middleware.ts`
(lines 108, 121, 150, 200, 236) and 2 in `lib/tenant/context.ts` (lines 35, 116). So the
`set_config` runs as its own implicit single-statement transaction and is discarded the moment that
statement completes, before the route's real queries run.

Measured on PostgreSQL 16:

```
-- Path A: what all 8 production call sites do
SELECT set_config('app.current_tenant','1111…',true);   -- returns 1111…
SELECT current_setting('app.current_tenant', true);     -- returns '' (empty)

-- Path B: withTenantContext — inside one explicit transaction
BEGIN;
  SELECT set_config('app.current_tenant','2222',true);
  SELECT current_setting('app.current_tenant', true);   -- returns 2222
COMMIT;

-- Path C: what the tenant_isolation policy then evaluates after Path A
SELECT current_setting('app.current_tenant')::uuid;
ERROR:  invalid input syntax for type uuid: ""
```

`withTenantContext` (Path B) is correct, but it is used by `lib/notifications.ts` only — 4 call
sites. Everything else goes through Path A.

**Two latent bugs have been masking each other.** PR #737 established that RLS policies are inert
because the app connects as the table owner. This finding shows that even with policies active, the
tenant GUC is empty by the time they evaluate. Had `FORCE ROW LEVEL SECURITY` been enabled without
also fixing context propagation, every tenant request through `lib/auth/middleware.ts` would have
failed with the uuid cast error above — not leaked data, but hard-errored.

That makes the ordering non-negotiable:

1. Fix context propagation so the tenant GUC survives into the query, and make the policy
   expression fail **closed** (deny) rather than fail **error** on an empty setting.
2. Verify with `npm run db:verify-isolation`.
3. Only then split the roles and enable `FORCE RLS`.

Doing step 3 first takes the application down. This is direct evidence for the decision in #737 to
land RLS as _correct_ before making it _enforced_.

`deploy/pgbouncer/pgbouncer.ini:10` does set `pool_mode = transaction`, so the issue's concern is
well-founded in principle — it just isn't reachable while the setting never outlives its own
statement.

**Not fixed here.** Step 1 is a behavioural change to the request path and belongs in its own PR.
#642 stays open.

### #674 — Database fail-proof layer

Addressed by #737: foreign keys across the revenue chain, `tenant_id` on the five money tables,
`NOT VALID` constraint strategy, and `npm run db:verify-isolation`.

Already present before this work: `lib/retry.ts`, `lib/db/pool.ts`, `lib/db/cache.ts`.

Still open: no circuit breaker (`grep -rl circuit lib/` finds only `lib/retry.ts`), no pool
health-check alerting, no graceful drain, no CHECK constraints on money amounts, and migration
rollback is 3/38 (see #640).

### #676 — Corruption-free data handling

- Transactional integrity: PR #733 (open) wraps 11 route files in `db.transaction()`.
- #735 fixed two silent-corruption paths: `lib/field-encryption` no longer substitutes `null` on
  decrypt failure, and `lib/tenant-data-import` no longer rejects every statement of a quoted
  `pg_dump` while reporting success with zero rows.

Still open — the specific silent catches the issue names are all still there:
`lib/user-defaults.ts:33`, `lib/client-prefs.ts:13`, `lib/dlp.ts:95`. Immutable-audit
BEFORE UPDATE/DELETE triggers are not implemented.

### #675 — Automated encrypted backup

Addressed by the backup commit in this branch (originally PR #736): the
`S3_ACCESS_KEY_ID` vs `S3_ACCESS_KEY` env mismatch (under Docker the upload block never ran, so
backups stayed in an ephemeral container while `backup_records.status` reported `completed`), the
wrong-bucket retention delete, and per-artefact checksums.

Two integration problems were found while folding it in: `app/api/cron/backup/route.ts` needed a
real three-way merge against the `db.transaction()` wrapping that #733 added on `main`, and
`0042_backup_records_checksum.sql` was **missing from `meta/_journal.json`**, so `db:migrate` would
never have created the `checksum` columns the route writes to. Both are fixed here.

Still open from the epic: WAL archiving / PITR, restore-to-ephemeral verification, cross-region
replication, quarterly DR test.

### #655 — API format and accessibility (3 of 7 sub-items)

| Sub-item                              | State                                                         |
| ------------------------------------- | ------------------------------------------------------------- |
| HG-23 leads response format           | investigated, deliberately **not** changed — #740             |
| HG-24 `EmptyState` unused             | open                                                          |
| MG-02 `safeJson` unused               | open                                                          |
| MG-03 envelope inconsistency          | inventoried, deferred — `docs/api-envelope-state.md`          |
| MG-17 no `aria-live` regions          | partly done (#739 route transitions); 3 occurrences repo-wide |
| MG-18 icon-only buttons               | **done** for the header — #740                                |
| MG-19 no schema-based form validation | open                                                          |

HG-23/MG-03 were deferred for a concrete reason: `lib/sdk/client.ts` returns
`response.json() as T` with no unwrapping, so 74 wrapping routes already hand back
`{ data }` where callers expect the bare entity. `leads` is the only SDK resource that works,
_because_ it's the non-conforming flat route. Standardising `leads` without fixing the SDK would
break the one method that behaves. Details and the per-method plan are in
`docs/api-envelope-state.md`.

Correction to HG-24: `components/shared/settings-empty-state.tsx` **is** used (3 settings pages).
It is `components/shared/empty-state.tsx` — the richer preset-based component — that has zero
imports.

### #640 — Rollback scripts for all 38 migrations

3 of 38 forward migrations now have a rollback: `0041_add_form_views_count.down.sql` (pre-existing),
plus `0043` and `0044` from #737 and #738.

**More important than the count:** these `.down.sql` files cannot currently be executed. The live
runner is `scripts/migrate.ts`, which calls drizzle's `migrate()` and has no concept of rollback.
`scripts/migration-runner.ts` — the only script that understands a `-- DOWN` section — is
orphaned and unreferenced. So rollback coverage is 3/38 _and_ 0/38 runnable.

Closing this issue requires a runner, not just 35 more SQL files. `docs/migration-chain-state.md`
(added in `f19414e`) documents the related chain breakage: the journal fails at position 2 because
`0037_flat_sir_ram` is a full drizzle-kit snapshot that re-creates 167 tables already made by
`0000_init`, so 35 of 38 migrations never run from scratch.

### #52 — Epic: enterprise infrastructure

Already present: CI workflow, PgBouncer in `deploy/`, `app/api/metrics/route.ts`, BullMQ, Sentry.

Untouched and still the largest availability gap: Postgres and Redis are single instances with no
replica and no failover, so both are single points of failure. No read replicas, no table
partitioning, no runtime feature flags, no log aggregation.

---

## Already satisfied — recommend closing

### #641 — Raise coverage threshold from 60% to 70%

The numeric ask is already met on `main`. `vitest.config.ts:36-41`:

```
lines: 70, functions: 70, branches: 80, statements: 70
```

The issue states current values of 60/55/78/60, which are stale.

Remaining valid half: the 8 excluded modules (`lib/backups/`, `lib/db/services/`, `lib/leads/`,
`lib/onboarding/`, `lib/plugins/`, `lib/restore/`, `lib/storage/`, `lib/usage/`) are still
excluded, and only `lib/usage/` has a matching unit test. Suggest retitling to cover the
exclusions only.

### #668 — Epic: Phase 1 test coverage

Both halves are done. Phase 1a: all 7 type-only/re-export files are in the coverage exclude list
(`vitest.config.ts:28-34`). Phase 1b: every named target has a test file — `errors-client.test.ts`,
`client-prefs.test.ts`, `dlp.test.ts`, `audit.test.ts`, `formula-engine.test.ts`,
`formula-sync.test.ts`, `use-form-validation.test.tsx`.

### #669 — Epic: Phase 2 SDK resource tests

Substantially done: `sdk-resources.test.ts`, `sdk-resource-methods.test.ts`,
`sdk-resources-batch.test.ts`, `sdk-resources-activities.test.ts`,
`sdk-resources-contacts.test.ts` plus 15 further `sdk-*.test.ts` files cover the 20 files in
`lib/sdk/resources/`. Worth confirming with a coverage run before closing.

Caveat: these tests pin the SDK's _current_ behaviour, which includes the unwrapping bug described
under #655. Coverage here is not evidence of correctness.

### #688 — Agent task division: 48 open issues

Stale. All 25 issues in the Agent 1 column are closed. Of the 22 in the Agent 2 column, 19 are
still open (#636, #637, #639 closed). The 19 + this issue are exactly the 20 open issues today, so
the table has no remaining tracking value and the "PRs Already Green" section predates the stack
above.

The rules at the bottom (never commit to main; branch + PR; run tests before pushing) are worth
preserving in `AGENTS.md` or a steering file rather than in a stale tracking issue.

---

## Untouched

| #   | Note                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 643 | All 5 files still present: `errors.ts`, `errors-client.ts`, `errors-server.ts`, `errors-shared.ts`, `api-error.ts`. Real ambiguity; a mechanical but wide change.                          |
| 644 | 3 SSE endpoints remain (`api/logs/stream`, `api/tenant/notifications/stream`, `api/superadmin/selective-restore/execute`). Needs the infra decision in #52 first.                          |
| 645 | `docs/adr/` does not exist. Note that `docs/api-envelope-state.md` and `docs/migration-chain-state.md` are ADRs in substance — adopting the process could start by moving them.            |
| 670 | Phase 3 DB-mocked service tests — not assessed.                                                                                                                                            |
| 671 | Phase 4 tenant context & auth middleware — not assessed. Overlaps #642; `lib/auth/middleware.ts` is where the RLS context bug lives, so tests here should pin the transaction requirement. |
| 672 | Phase 5 automation engine & calendar sync — not assessed.                                                                                                                                  |

### #638 / #422 — file size

Both are partly stale. `lib/api/schemas.ts` (listed at 1,078 lines) no longer exists. The others
have grown: `drizzle/schema/_registry.ts` 3,754, `components/tenant/docs-client.tsx` 2,305,
`scripts/seed-dev.ts` 1,241, `components/tenant/contact-detail-client.tsx` 1,087,
`app/superadmin/selective-restore/page.tsx` 1,004.

These overlap heavily — #638 is the >1000-line subset of #422. Suggest closing #638 into #422.

Note that `_registry.ts` is generated-style barrel re-export code; splitting it by hand has far
less value than the component files, and line count is a weak proxy for the risk the issues are
actually pointing at.

---

## Recommended next actions

1. **Fix RLS tenant-context propagation** (#642 step 1) — highest value. Proven broken above, and
   it blocks `FORCE RLS`, which blocks database-enforced tenant isolation.
2. **Build a migration runner that understands rollback** (#640) — the 3 existing `.down.sql`
   files are currently decorative.
3. **Land the migration baseline** (#640, `docs/migration-chain-state.md`) — blocked on how
   production was provisioned (`db:push` vs `db:migrate`) and whether it holds live data.
4. **Close #688, #668; retitle #641; fold #638 into #422** — reduces 20 open issues to 16 with no
   code change.
5. `safeJson` (#655 MG-02) is a small, safe, non-breaking fix: malformed JSON currently yields 500
   instead of 400.

# #2538 Option A — Make the Migration-Chain Check Real (Foolproof Plan)

> **Decision already taken by the owner: Option A.** This document is the
> execution plan. It is written so that no other work, no `main` history, and no
> live database is disturbed. No step here touches production data.

## 1. What we actually measured (2026-11-24)

The issue text was written at `main = b49021db` and is partly stale. Fresh evidence:

| Finding                                                                                        | Evidence                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `db:verify-chain` fails at **`0003_billing_migration`**: `relation "contracts" already exists` | Run against a `postgres:16-alpine` scratch DB; exit 1 after applying 2 of 153 migrations                                                       |
| The overlap starts in **`0002_flat_sir_ram`**, not `0000_init` / a `0037_flat_sir_ram`         | `0002` creates 74 tables; `0003` re-creates 8 of them                                                                                          |
| **31 duplicate `CREATE TABLE` statements** across the journal                                  | Regex scan of all 153 up-files in journal order; pairs listed below                                                                            |
| `0036_backup_records_checksum.down.sql` **exists**                                             | `ls drizzle/migrations/0036*`; `db:rollback:coverage` reports OK for all entries                                                               |
| Schema equality is **already partly automated**                                                | `ci.yml` `fresh-install` runs `db:bootstrap` then `db:drift-check`; `scripts/drift-check.ts` checks presence, type **and nullability** (#2508) |
| `guard:chain` is green                                                                         | `153 up-file(s) · 153 journal entries · 53 defect(s), 53 baselined`                                                                            |

Duplicate `CREATE TABLE` owners (first → repeated in):

```
0002_flat_sir_ram -> 0003_billing_migration: contracts, invoice_line_items,
  invoice_payments, invoices, order_line_items, orders, service_categories, services
0002_flat_sir_ram -> 0004_fix_duplicate_tables: webhook_queue
0002_flat_sir_ram -> 0006_brute_force_protection: login_attempts, login_blocks, security_events
0002_flat_sir_ram -> 0007_super_admin_audit_logs: super_admin_audit_logs
0002_flat_sir_ram -> 0008_documents: documents
0002_flat_sir_ram -> 0013_workflow_foundation, 0018_workflow_foundation_legacy: lead_offers
0002_flat_sir_ram -> 0014_approval_requests: approval_requests
0002_flat_sir_ram -> 0016_missing_ai_tables, 0017_missing_ai_tables_legacy:
  ai_activity, ai_draft_templates, at_risk_rules, comm_email_drafts
0013_workflow_foundation -> 0018_workflow_foundation_legacy:
  ai_providers, tenant_ai_credentials
0002_flat_sir_ram -> 0023_follow_ups: follow_ups
0047_webhook_field_mappings -> 0058_webhook_field_mappings: webhook_field_mappings
0059_custom_entities -> 0071_schema_drift_backfill: custom_entities, custom_entity_data
```

## 2. The safe strategy (why not literally rewrite 31 migrations)

Rewriting applied migration files changes their SHA-256. `planMigrations()` skips a
file when **either** its hash **or** its `created_at` is in the ledger, so live DBs
would still skip them — but every fresh `db:bootstrap`, the CI `fresh-install` job,
the release gate and all down-migration tests would be re-running changed SQL.
That is a large blast radius for a check whose purpose is to _prove_ the chain.

**Decision:** keep all 153 migration files and journal entries byte-identical.
Make the verifier use the **same statement runner that succeeds** (`scripts/migrate-fresh.ts`
/ `db:bootstrap`) and pair it with the **existing** `db:drift-check` screen. This
achieves Option A's outcome — a green, real, CI-gated check — with zero migration
rewrites. If the owner later insists on one drizzle-native chain, that becomes a
separate, larger project with its own plan (§7).

## 3. Non-negotiable safety rules

1. **No live database is read or written by any implementation step.** Scratch DBs only.
2. **No migration file, journal entry, or schema snapshot is edited.**
3. **No direct push to `main`.** Every change goes through a feature branch + PR;
   CI must be green; no self-merge.
4. **New CI job placement:** insert _after_ every register-cited coordinate and
   _before_ `destructive-gate` and `constraint-vocab` — six tests pin those two as
   the last jobs. Do not add a new `guard:*` alias without the census bookkeeping
   required by AGENTS.md rule 7.
5. **No secret, connection string or credential is written to a tracked file.**
6. **Backup before any release action**: the live backup + restore drill is a hard
   prerequisite for the 0.9.2 tag, owned by the infra owner (§6).

## 4. Phases

### Phase 0 — Backup first (owner, before anything else)

On the deploy host, not in this repo:

```bash
bash deploy/scripts/backup.sh                 # full pg_dump → local + S3
npm run backup:verify                         # real pg_restore into scratch, row checks
npm run db:state                              # EMPTY / SEEDED / POPULATED, never prints URL
```

Record the dump path, checksum and drill result in `docs/runbooks/go-live.md` §7.
Nothing in Phases 1–5 touches that database; this is the insurance policy.

### Phase 1 — Replace the verifier engine (no migration edits)

File: `scripts/verify-migration-chain.ts`.

- Keep the CLI contract (`DATABASE_URL`, empty-target guard, exit 0/1).
- Replace the drizzle-native `migrate()` loop with the repo's own replay engine
  (`planMigrations` + `runFreshReplay` from `scripts/migrate-fresh.ts`), the same
  engine `db:bootstrap` uses and CI already proves.
- Remove the stale "KNOWN TO FAIL / 0000_init and 0037_flat_sir_ram" header; replace
  with the measured §1 facts and the reason the engine is shared.
- Keep fail-loud semantics: any fatal file → non-zero, no false green, no stamp
  without apply.

**Done when:** `DATABASE_URL=<scratch> npm run db:verify-chain` exits 0 on an empty
PostgreSQL 16 DB, produces 153 ledger rows, and a second run is a no-op.

### Phase 2 — Schema-equality screen

- Use `npm run db:drift-check` (already checks table/column presence, **type and
  nullability**, RLS policies and functions) against that same chain-built scratch DB.
- Add a small wrapper step to the verifier or CI that runs both in order and fails
  if either fails. Do not widen `scripts/schema-drift-allowlist.json` without a
  written reason and a tracking issue.
- This specifically prevents a repeat of PP-067, where `0071`'s
  `CREATE TABLE IF NOT EXISTS` silently skipped six `NOT NULL` columns.

**Done when:** verifier + drift-check both exit 0 on one fresh scratch DB, and a
deliberately narrowed column (negative control) makes drift-check exit 1.

### Phase 3 — Wire into CI

- Add a job/步骤 that provisions a `postgres:16-alpine` service, runs
  `npm run db:verify-chain` and `npm run db:drift-check` on it, with a negative
  control proving the screen can fail.
- Place it before `destructive-gate`/`constraint-vocab` (see safety rule 4).
- If a new npm alias is added, do the AGENTS.md rule 7 census bookkeeping in the
  same PR; otherwise call the existing scripts directly.

**Done when:** CI job green on the PR; a planted defect turns it red in a scratch
negative-control run (not on main).

### Phase 4 — Close the issue honestly

- Update `docs/migration-chain-state.md` and `docs/migration-recovery.md` with the
  measured facts, the chosen engine, and the CI gate.
- Keep `guard:chain` (it polices the manifest and is green).
- Close #2538 with a PR body that names the evidence and says what changed.

### Phase 5 — Release 0.9.2

Preconditions: CI green on the tagged commit, backup drill recorded, no P0 open
that the release claims to fix (0.9.2 is a prerelease-shaped `v0.9.x`, not GA).

```bash
# ONE commit: bump + tag, in that order, on main
git checkout main && git pull
# edit package.json 0.9.1 -> 0.9.2, commit
git tag v0.9.2 <that-commit>
git push origin main --follow-tags
gh release create v0.9.2 --generate-notes   # or let .github/workflows/release.yml do it
```

`.github/workflows/release.yml` already enforces: semver tag, tag commit is an
ancestor of `main`, `package.json` version equals the tag, CI green for that SHA,
and `LAUNCH_GATE_STRICT=1 npm run launch-gate`. **It does not deploy** — deploy
stays blocked by #2299; the release is a certification record only.

## 5. Rollback / blast radius

- All code changes are additive to scripts/CI/docs; reverting the PRs restores
  the previous state. No schema or data change is made by Phases 1–4.
- The scratch databases are disposable and can be dropped at any time.
- If a phase fails, stop; do not "fix forward" on `main`.

## 6. Explicit non-goals

- Fixing #2299 (deploy secrets) — owner infra action, prerequisite for _deploying_
  0.9.2, not for _releasing_ it.
- Rotating the credentials posted in chat — owner action, separate.
- Enabling branch protection (#2305) — owner GitHub-settings action.
- Re-cutting the 31 duplicate migrations into one drizzle-native chain — see §7.

## 7. If the owner later requires one literal drizzle-native chain

Separate project, not part of this plan:

1. For each of the 31 duplicate `CREATE TABLE`s, decide: keep the first definition
   and convert later ones to `IF NOT EXISTS` **plus explicit `ALTER TABLE … ADD
COLUMN IF NOT EXISTS`** for every column the later file declares; or delete the
   later statement if the first definition already has the final shape.
2. Prove per-table column equality with a generated diff against `drizzle/schema`.
3. Re-run every down-migration and the full fresh-install suite.
4. Only then switch the verifier back to drizzle's native migrator.
   This changes applied migration bytes and must be its own reviewed PR series.

## 8. Tracking issues

Created alongside this plan:

- **#3824** — Phase 1: verifier engine swap
- **#3826** — Phase 2: schema-equality gate + negative control
- **#3827** — Phase 3: CI wiring with correct job placement
- **#3828** — Phase 0/5: owner backup drill + 0.9.2 release checklist (owner action)

Dependency order: #3828 Phase 0 (backup) → #3824 → #3826 → #3827 → #3828 Phase 5 (release).

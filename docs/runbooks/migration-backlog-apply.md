# Migration Backlog Apply (#2537)

> **Owner runbook — infrastructure action, not a code change.** This is the
> maintenance-window procedure for bringing the live database current with the
> migration journal. Read it end to end before running anything against live.

## Why this exists

The journal in `drizzle/migrations/meta/_journal.json` is the list of schema
changes the code expects. The ledger `drizzle.__drizzle_migrations` on the live
database is the list of changes actually applied. They diverged: at the
2026-10-10 measurement the journal had 126 entries and **27 had never been
applied**. That is why "tests pass" and "preprod behaves differently" are both
true — CI provisions with `db:sync`, which never executes the journal, and the
only automated migrate step lives in the Deploy workflow, which has never
succeeded (#2299).

The pile grows as entries are added: the same journal has 153 entries as of
2026-11-21. **Never trust a count from an issue thread — re-measure the live
ledger.**

### Hard prerequisite

**Fix #2299 first.** #2537 explicitly cannot be closed before the deploy hop
works. Applying migrations to a host whose code cannot be rolled forward or
back is how schema and code drift permanently. If a deploy is impossible, run
this procedure only as a deliberate, documented exception.

---

## Prerequisites checklist

- [ ] #2299 fixed — a merge to `main` produces a green Deploy and a healthy `/api/health`.
- [ ] A **verified** backup exists (create with `bash deploy/scripts/backup.sh`, prove with `npm run backup:verify` — #1038, #1476). A restore point is the only thing that makes the apply reversible.
- [ ] `BACKUP_DATABASE_URL` points at a role that can read every tenant under `FORCE ROW LEVEL SECURITY` (PP-014). The app role cannot produce a complete dump.
- [ ] `BACKUP_LOCAL_DIR` points at **durable** storage. A restore point under `/tmp` (or `/var/tmp`) is refused — a reboot would erase it, and this host has already lost an app to one.
- [ ] `pg_dump` is on `PATH` on the deploy host.
- [ ] A maintenance window is booked. Pending entries include RLS policy rewrites and `SET NOT NULL` work (`0123`, `0124`, `0125`, `0146`); applying them to a table with rows has a write-path effect.
- [ ] The checkout is on the exact commit that is deployed (`main`), with a clean tree.

---

## What the automation does

`npm run db:apply-backlog -- --yes` is one command for the whole runbook. Each
stage fails closed:

| Stage         | What happens                                                                                                                            | On failure                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Measure    | `npm run db:status` → `Pending: N`, read from `drizzle."__drizzle_migrations"`                                                          | Abort; the status output is printed                       |
| 2. Classify   | Diff journal vs ledger; classify destructive SQL with the same classifier `deploy-migrate` uses                                         | Abort if the status count and the diff disagree           |
| 3. Protect    | Require `BACKUP_DATABASE_URL` when anything destructive is pending; require durable `BACKUP_LOCAL_DIR`; require `pg_dump`               | Abort before any write                                    |
| 4. Dump       | `pg_dump -Fc` into `<BACKUP_LOCAL_DIR>/pre-backlog-<timestamp>.dump`; assert the file is non-empty                                      | Abort; no migrate runs without a restore point            |
| 5. Apply      | `npm run db:migrate -- --yes` (the production runner that builds from empty and tolerates "already exists" — **not** `db:verify-chain`) | Abort; schema stays where it stopped, forward-only (§6.3) |
| 6. Re-measure | `npm run db:status` again; require `Pending: 0`                                                                                         | Abort with a loud error                                   |
| 7. Record     | Print a paste-ready runbook line with the date, starting count and applied tags                                                         | —                                                         |

`--dry-run` performs stages 1–2 only. It never backs up, writes or restarts.

### Do not use

- `npm run db:verify-chain` for this apply — that runner still fails on the two overlapping lineages.
- `drizzle-kit push` / `npm run db:sync` — creates tables and columns, no RLS policies, no functions, and no ledger.
- A manual `INSERT` into the ledger — stamping without applying produces an unprotected database labelled as migrated.

---

## Procedure

### 1. Preflight (read-only)

```bash
cd <repo>
git checkout main && git pull
npm ci

# Re-measure. PROBE_DATABASE_URL takes precedence over DATABASE_URL.
DATABASE_URL=<live app url> npm run db:status
# Expect: "ledger rows: N", "Pending: M", "Total: 153 journal entr(ies)"
```

Cross-check with `DATABASE_URL=<live app url> npm run db:migrate -- --dry-run`.
If the two tools disagree, stop — that is a ledger-read problem, not a backlog.

### 2. Prove the restore point (#1476) — before step 3

```bash
bash deploy/scripts/backup.sh
npm run backup:verify
```

Record the dump path and the drill result. Do not proceed on a backup that has
never been restored.

### 3. Dry-run the automation

```bash
export DATABASE_URL=<live app url>
export BACKUP_DATABASE_URL=<bypass role url>
export BACKUP_LOCAL_DIR=/var/backups/nucrm     # durable, not /tmp

npm run db:apply-backlog -- --dry-run
```

Read the pending list and the `destructive pending migration(s)` line. If
anything destructive is listed and `BACKUP_DATABASE_URL` is unset, the real run
will refuse — that refusal is correct.

### 4. Apply (maintenance window)

```bash
npm run db:apply-backlog -- --yes
```

Successful output ends with:

```
[apply-backlog] - #2537 backlog applied <date>: M pending → 0; ...
[apply-backlog] restore point (do not delete): /var/backups/nucrm/pre-backlog-....dump
```

If any stage fails, **do not hand-edit the database**. Capture the last status
line, open a register entry in `docs/infra/PREPROD-ISSUE-REGISTER.md`, and keep
the restore point. A failed migration is forward-only: the schema is left where
it stopped, and re-running resumes from the last stamped entry.

### 5. Confirm

```bash
DATABASE_URL=<live app url> npm run db:status
# Expect: Pending: 0, "Database is up to date"

# Optional catalog floors:
DATABASE_URL=<live app url> npm run db:drift-check
```

Re-run the six PP-061 paths from `docs/infra/PREPROD-ISSUE-REGISTER.md` before
declaring the host fixed.

### 6. Record the result

Paste the printed record line into the table in
[`go-live.md` §7a](./go-live.md). Include the date, the starting pending count,
the restore point path and the operator. Re-run the apply procedure after any
future release that adds migrations.

---

## Prove it before the window (simulation)

The simulation builds the "behind" state on a **throwaway** database with the
same engine `db:migrate` uses, runs the real apply command, then re-reads the
ledger and catalog. It refuses a non-empty target and a database whose name
does not look like a scratch DB.

```bash
docker run -d --name nucrm-sim-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nucrm_sim -p 55432:5432 postgres:16-alpine
export DATABASE_SSL=false
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/nucrm_sim

# The issue's measured case: 27 pending on a 126-entry journal.
npm run db:simulate-backlog -- --applied 126

# A deeper case: 54 pending.
docker exec nucrm-sim-pg createdb -U postgres nucrm_sim2
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/nucrm_sim2 \
  npm run db:simulate-backlog -- --applied 99
```

A PASS looks like:

```
[simulate] PASS build-behind-state: 126 ledger rows stamped, 3281 statements replayed
[simulate] PASS confirm-behind: 27 pending (expected 27)
[simulate] PASS db:migrate --yes: exit 0
[simulate] PASS ledger-current: 153/153 ledger rows, 0 unstamped
[simulate] PASS catalog-floors: 313 policies (≥200), 228 RLS tables (≥200)
[simulate] BACKLOG APPLIED CLEANLY
```

`ci.yml` runs both simulations on every PR (`migration-backlog-simulation`
job), so a broken pending migration fails CI rather than a maintenance window.

---

## Blockers the simulation found (fixed 2026-11-21)

| Migration                | Failure on PostgreSQL 16                                                                                                                                                                                            | Fix                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0118_fk_column_indexes` | `42703: column i.indisconstraint does not exist` — that column is not in `pg_index`                                                                                                                                 | Test for constraint-backed indexes with `pg_constraint.conindid`                                                                                                                                                                                                             |
| `0146_rls_tombstone_arm` | `42703: column p.polusing does not exist`; then ambiguous `pg_node_tree` concatenation; then `WITH CHECK cannot be applied to SELECT or DELETE`; then its final assertion counted 88 policies it deliberately skips | Read expressions with `pg_get_expr(polqual/polwithcheck, polrelid)`; emit only clause combinations PostgreSQL accepts; scope the final assertion to what the loop actually arms. Also fixed four `app/include_deleted` typos (`app/include_deleted` → `app.include_deleted`) |

Both files were in the **pending** set, so changing them did not rewrite any
applied migration. `tests/unit/migration-backlog-automation-2537.test.ts` pins
the corrected catalog accessors and the automation helpers.

---

## Troubleshooting

| Symptom                                                    | Meaning                                                                               | Action                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `db:status` says `ledger rows: 0` but the schema exists    | Either a genuinely fresh DB or a failed read; the two are indistinguishable from here | Check the connection and `drizzle."__drizzle_migrations"` directly. Do not assume "nothing applied".                        |
| `deploy-migrate` aborts with `aborted-snapshot` (#2262)    | Ledger read as 0 against a populated journal — the deploy path refuses to guess       | Confirm the ledger; if genuinely fresh, use `npm run db:migrate -- --yes` by hand                                           |
| `could not read the Pending: count from db:status`         | The status tool failed before its summary                                             | Read the printed error; fix the connection/credentials and re-run                                                           |
| `destructive migrations pending — set BACKUP_DATABASE_URL` | A pending file drops data or the classifier cannot prove it safe                      | Provision a bypass role and re-run; never bypass this check                                                                 |
| `BACKUP_LOCAL_DIR is ephemeral`                            | Dump would land under `/tmp` or `/var/tmp`                                            | Point it at durable storage                                                                                                 |
| `db:status still reports N pending`                        | Apply exited but the ledger is not current                                            | Stop; capture the ledger diff and open a register entry                                                                     |
| `FATAL in <tag>.sql` mid-apply                             | A pending migration aborted; nothing after it ran                                     | Keep the restore point, capture the statement, open a register entry. Re-run resumes from the last stamped entry once fixed |

### If you must roll back

Migrations are **forward-only** (`.kiro/steering/global-standards.md` §6.3).
The apply script never reverses DDL and never deletes a backup. The printed
restore point is the recovery path; `npm run db:rollback -- <tag> --yes` exists
only for tags that have rollback SQL and must be run deliberately, not from a
failed pipeline.

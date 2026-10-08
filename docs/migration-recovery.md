# Migration Ledger Recovery (post-stamp verification)

Issue #1969 (follow-up to #966), extended by #2450 (push vs dump, and
attributing a failed stamp). This documents the empty-ledger recovery
path in `scripts/migrate.ts` and what to do when it refuses to stamp.

## When recovery kicks in

`db:migrate` takes a session-scoped advisory lock, then inspects the
ledger drizzle actually consults: `drizzle.__drizzle_migrations`. If the
ledger is empty **and** the journal has entries, migrate decides between:

1. **Fresh DB** — no app schema present → run every migration for real.
2. **Recovery (stamp)** — schema present, both markers exist
   (early marker: table `api_key_usage`; late marker: column
   `backup_records.last_verified_at`) **and `pg_policy` has rows**, which is
   how a dump-restored database is told apart from a `db:push`/`db:sync` one
   (#2450). Stamp all journal entries instead of replaying DDL over live
   tables.
3. **Push-provisioned (refuse before stamping, #2450)** — markers match but
   `pg_policy` is empty. `drizzle-kit push` creates tables and columns only,
   so this schema has no RLS policy and no SQL function: the journal never ran
   here. Stamping would label an unprotected database as migrated, so migrate
   exits 1 naming the missing object classes and `npm run db:bootstrap`, and
   writes no ledger row.
4. **Partial schema (refuse)** — early marker present, late marker
   missing. Stamping would cement drift; replaying would run 0000_init
   over live tables. Migrate exits 1 and asks for a decision.

## Post-stamp verification (#1969)

After stamping, `scripts/migrate.ts` symbolically replays every journal
file's DDL (CREATE/DROP TABLE, ADD/DROP/RENAME COLUMN, RENAME TABLE —
dynamic SQL inside `DO $$` blocks is excluded) to build the set of
tables and columns the journal claims exist, then compares it against
`information_schema`. Any mismatch:

- prints the missing objects grouped by the journal entry that promised them,
  with the total count and per-entry counts (#2450 AC4) — 21 bare function
  signatures tell you nothing to fix; `0032_missing_db_functions — 16 object(s)`
  tells you which file to read,
- **truncates the seeded stamp** so the next run doesn't see a
  "migrated" ledger,
- exits non-zero before any "All migrations applied successfully" line.

Treat a verification failure as: this DB is NOT at the stamped state.

## Recovery procedure for a failed stamp / new-region restore

1. Take a backup of the affected database before touching anything
   (`scripts/backup-db.sh`).
2. Identify the drift from the reported missing objects — usually a
   partial `db:push` or a restore from an older dump.
3. Preferred fix: replay the missing migrations by hand from
   `drizzle/migrations/NNNN_*.sql` (they are idempotent-guarded with
   IF NOT EXISTS where possible), then re-run `npm run db:migrate`.
4. Alternative for a restorable system: wipe the schema and restore
   from the latest verified dump, then run `npm run db:migrate` so the
   ledger matches history exactly.
5. After any recovery, run `npm run db:drift-check` and
   `npm run db:verify-integrity` and only then route traffic back.

Never manually insert rows into `drizzle.__drizzle_migrations` — that
recreates exactly the blind-stamp hazard this check exists to catch.

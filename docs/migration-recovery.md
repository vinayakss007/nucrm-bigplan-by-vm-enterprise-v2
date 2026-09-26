# Migration Ledger Recovery (post-stamp verification)

Issue #1969 (follow-up to #966). This documents the empty-ledger recovery
path in `scripts/migrate.ts` and what to do when it refuses to stamp.

## When recovery kicks in

`db:migrate` takes a session-scoped advisory lock, then inspects the
ledger drizzle actually consults: `drizzle.__drizzle_migrations`. If the
ledger is empty **and** the journal has entries, migrate decides between:

1. **Fresh DB** — no app schema present → run every migration for real.
2. **Recovery (stamp)** — schema present and both markers exist
   (early marker: table `api_key_usage`; late marker: column
   `backup_records.last_verified_at`) → the DB was provisioned by
   `db:push`/`db:sync` or restored from a dump. Stamp all journal
   entries instead of replaying DDL over live tables.
3. **Partial schema (refuse)** — early marker present, late marker
   missing. Stamping would cement drift; replaying would run 0000_init
   over live tables. Migrate exits 1 and asks for a decision.

## Post-stamp verification (#1969)

After stamping, `scripts/migrate.ts` symbolically replays every journal
file's DDL (CREATE/DROP TABLE, ADD/DROP/RENAME COLUMN, RENAME TABLE —
dynamic SQL inside `DO $$` blocks is excluded) to build the set of
tables and columns the journal claims exist, then compares it against
`information_schema`. Any mismatch:

- prints the missing objects (first 50),
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

# Migration Drift Recovery

## When you need this

`npm run db:migrate` refuses with:

```
[migrate] ERROR: Database has schema but it is NOT at the latest migration state.
[migrate] Ledger is empty but marker for the last migration (0044_backup_verification) is missing.
```

This means:
- The `drizzle.__drizzle_migrations` table is empty (no rows)
- The database **does** have tables (it was provisioned with `db:push` / `db:sync`, or restored from a partial dump)
- But the schema is **not** at the latest migration — some migrations were never applied

---

## Step 1: Determine which migrations ARE applied

Connect to the database and check for marker columns/tables from each migration:

```sql
-- Check the latest few migrations' markers:
-- 0044_backup_verification adds last_verified_at to backup_records
SELECT EXISTS (SELECT FROM information_schema.columns
  WHERE table_name = 'backup_records' AND column_name = 'last_verified_at');

-- 0043_audit_logs_retain_actor adds actor_name to audit_logs
SELECT EXISTS (SELECT FROM information_schema.columns
  WHERE table_name = 'audit_logs' AND column_name = 'actor_name');

-- 0042_audit_log_immutability creates immutability triggers
SELECT EXISTS (SELECT FROM pg_trigger WHERE trgname LIKE '%audit_immutable%');

-- 0041_teams adds teams table
SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'teams');

-- 0040_lead_product_service_request adds requested_service_id to leads
SELECT EXISTS (SELECT FROM information_schema.columns
  WHERE table_name = 'leads' AND column_name = 'requested_service_id');

-- 0045_check_constraints adds CHECK constraints
SELECT conname FROM pg_constraint WHERE conname LIKE 'chk_%' LIMIT 5;
```

Record the **last migration that IS applied**. For example, if 0041's marker exists but 0042's does not, the schema is at 0041.

---

## Step 2: Apply the missing migrations manually

Each migration has a `.sql` file in `drizzle/migrations/`. Apply them in order:

```bash
# Example: schema is at 0041, need 0042-0045
psql $DATABASE_URL -f drizzle/migrations/0042_audit_log_immutability.sql
psql $DATABASE_URL -f drizzle/migrations/0043_audit_logs_retain_actor.sql
psql $DATABASE_URL -f drizzle/migrations/0044_backup_verification.sql
psql $DATABASE_URL -f drizzle/migrations/0045_check_constraints.sql
```

**Important:** Run each one individually. If one fails, you know exactly where to investigate. Do NOT combine them.

---

## Step 3: Stamp the migration ledger

Once all migrations are applied, seed the ledger so `db:migrate` knows the current state:

```sql
-- Get the journal entries (run from the app host, not psql)
-- The journal is in drizzle/migrations/meta/_journal.json

-- Insert all entries:
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
VALUES
  ('0000_init', 1700000000000),
  ('0001_perpetual_the_stranger', 1700000001000),
  -- ... all entries from _journal.json ...
  ('0045_check_constraints', 1700000045000);
```

Or use the helper script:

```bash
# This stamps ALL migrations as applied without executing SQL
# ONLY use this after verifying Step 2 completed successfully
npx tsx -e "
const j = require('./drizzle/migrations/meta/_journal.json');
const stmts = j.entries.map(e =>
  \`INSERT INTO \"drizzle\".\"__drizzle_migrations\" (hash, created_at) VALUES ('\${e.tag}', \${e.when});\`
);
console.log(stmts.join('\n'));
" | psql $DATABASE_URL
```

---

## Step 4: Verify

```bash
npm run db:migrate
# Should output: "All migrations applied successfully" (with 0 pending)

# Run the app's health check
curl http://localhost:3000/api/health
```

---

## How this state happens

1. **`db:push` / `db:sync`** — `drizzle-kit push` applies schema changes directly without recording them in the migration ledger. CI uses this (`npm run db:sync`), which is why the ledger can be empty while the schema exists.

2. **Partial restore** — A database dump restored from a snapshot that included tables but not the `drizzle.__drizzle_migrations` ledger data.

3. **Manual DDL** — An operator ran migration SQL manually (e.g. during an incident) without stamping the ledger.

---

## Prevention

- Never use `db:sync` / `db:push` on a production database. It is for CI only.
- Always use `npm run db:migrate` for production schema changes.
- After any manual restore, verify `SELECT count(*) FROM drizzle.__drizzle_migrations` matches the journal entry count (currently 46).
- The `db:migrate` script now checks for the latest migration's marker before stamping, so this scenario will be caught early rather than silently cementing drift.

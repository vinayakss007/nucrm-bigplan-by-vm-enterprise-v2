# `pg_dump` fails as the app role (FORCE ROW LEVEL SECURITY + `row_security=off`) (PP-014)

**Severity:** CRITICAL — no working backup
**Area:** Infra / deploy · Data integrity
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-014](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

`deploy/scripts/backup.sh` cannot produce a dump. `pg_dump` deliberately runs `SET row_security = off`,
and because all tenant-scoped tables are `FORCE ROW LEVEL SECURITY` while the app role is neither
superuser nor `BYPASSRLS`, PostgreSQL refuses:

```
pg_dump: error: query would be affected by row-level security policy for table "activities"
HINT: ... use ALTER TABLE NO FORCE ROW LEVEL SECURITY
```

## Steps to reproduce

```bash
cd /srv/nucrm && bash deploy/scripts/backup.sh      # exits non-zero
```

## Expected vs actual

- **Expected:** a complete dump, uploaded to object storage.
- **Actual:** the dump aborts; before the PP-004 fix it also left a truncated file behind.

## Why

This is the intended interaction between `FORCE ROW LEVEL SECURITY` and `row_security=off`, not a
misconfiguration: **dump rights and app rights must differ**. The `HINT` (disabling FORCE) must not be
followed — it would silently strip the isolation guarantee for the application.

## File / route

- `deploy/scripts/backup.sh`, `scripts/backup-db.sh`
- `drizzle/migrations/0068_*` (`FORCE ROW LEVEL SECURITY`)

## Proposed fix

Run backups as a role with `BYPASSRLS` — `upadmin` already exists — by pointing `BACKUP_DATABASE_URL` at
it (tracked separately as PP-015). `BACKUP_DATABASE_URL` is read only by the backup script, so this does
not widen the application's privileges. Confirm with:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('nucrm','upadmin','postgres');
```

Then verify the dump by restoring it, not by checking that a file exists.

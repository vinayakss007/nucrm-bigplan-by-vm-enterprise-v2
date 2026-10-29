# NuCRM Database Security Guide

> **A count is not a census until you say who counted.** The application role is not the
> table owner, is not a superuser and has no `BYPASSRLS`, so Row Level Security binds it on
> **every** table where it is enabled — measured on the live schema: 226 tables, 226 with
> row security. 17 of them carry a `FOR SELECT USING (true)` policy and read honestly from
> any session (`tenants`, `plans`, `backup_records`…); for the other 209 a session that sets
> neither `app.current_tenant` nor `app.is_super_admin` is admitted to **no rows**: `count(*)`
> answers 0, `sum()` answers null, `EXISTS` answers false, `SELECT` returns nothing, and none of
> it raises. Measured
> on a development database — `users` 0 against 28, `contacts` 0 against 66, `deal_stages` 0
> against 146. **Every count, sum and `exists` check run as the app role is filtered by RLS: a
> zero result is not evidence of absence.** `npm run db:count -- <table>` asks the catalog what the table allows, runs the
> same count in both contexts and prints the gap; `guard:app-role-counts` screens `scripts/`
> so a new script cannot quote a number without naming its context (#3280). Over HTTP,
> `GET /api/setup/status` is the same discipline in two integers
> (`super_admin_exists`, `workspace_count`): it counts inside the security context
> `POST /api/setup/create-admin` uses for its own guard, answers 503 rather than a confident
> zero when the read fails, and carries no PII — so "already done" and "not yet done" are
> distinguishable without writing any SQL.

## Overview

This document covers all database security practices for NuCRM — backup/restore, migration safety, container persistence, and disaster recovery.

---

## 1. Data Persistence (Container Safety)

PostgreSQL data lives in a **Docker named volume** — it survives `docker compose down` and `docker compose restart`.

```yaml
# docker-compose.yml — line 111
volumes:
  - pgdata:/var/lib/postgresql/data
```

### Safe Commands (data preserved)

| Command                                       | Effect                               |
| --------------------------------------------- | ------------------------------------ |
| `docker compose down`                         | Stops containers, data safe          |
| `docker compose restart`                      | Restarts containers, data safe       |
| `docker compose up -d`                        | Starts/updates containers, data safe |
| `docker compose down && docker compose up -d` | Full restart, data safe              |

### DANGEROUS Commands (will WIPE data)

| Command                                    | Effect                                 |
| ------------------------------------------ | -------------------------------------- |
| `docker compose down -v`                   | Removes volumes — **DELETES ALL DATA** |
| `docker volume rm nucrm-enterprise_pgdata` | Same — **DELETES ALL DATA**            |
| `docker system prune -a --volumes`         | Prunes everything including volumes    |

> **Never use `-v` or `--volumes` flags on production.**

---

## 2. Backups

### Automated Backup Script

```bash
# Run manually
DATABASE_URL="postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" \
  npx tsx scripts/backup-db.ts
```

The script:

1. Runs `pg_dump` to create a full SQL dump
2. Uploads to S3 (if `S3_ENDPOINT` is configured)
3. Cleans up backups older than 30 days

### Quick Manual Backup (no S3)

```bash
pg_dump "postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" > \
  /home/ubuntu/nucrm-backup-$(date +%Y-%m-%d).sql
```

### Cron (Automatic Daily)

Add to crontab (`crontab -e`):

```
0 2 * * * cd /home/ubuntu/nucrm-enterprise && DATABASE_URL="postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" npx tsx scripts/backup-db.ts >> /var/log/nucrm-backup.log 2>&1
```

---

## 3. Restore

### Full Restore

```bash
# Drop and recreate (WARNING: destroys current data)
psql "postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" < backup.sql
```

### Selective Restore (Table-Level)

The app has a selective restore UI at `/superadmin/selective-restore` backed by:

| File                              | Purpose                                    |
| --------------------------------- | ------------------------------------------ |
| `lib/restore/backup-parser.ts`    | Parses SQL dump into individual statements |
| `lib/restore/backup-verifier.ts`  | Checks backup integrity before restore     |
| `lib/restore/restore-executor.ts` | Executes targeted restore operations       |

---

## 4. Migration Safety (Schema Changes)

All schema changes use **Drizzle Kit migrations**. Each change is versioned and reversible.

### Safe Migration Workflow

```bash
# 1. BACKUP FIRST (always)
pg_dump "postgresql://..." > pre-migration-backup.sql

# 2. Generate migration
npx tsx scripts/generate-migration.ts

# 3. Check migration status
npx tsx scripts/migration-status.ts

# 4. Apply
npx tsx scripts/migrate.ts

# 5. Rollback if needed
npx tsx scripts/rollback-migration.ts
```

### Drizzle Migration Principles

- Drizzle generates **additive** migrations by default — columns are added, not dropped
- Dropping columns/ tables requires an **explicit `drop`** in the migration file
- Always review the generated SQL before applying
- Test migrations on a staging copy first

---

## 5. Connection Pool Safety

The app uses a connection pool (default: **20** connections — `lib/db/pool.ts`, configurable via `DATABASE_POOL_SIZE`).

```env
DATABASE_POOL_SIZE=20    # Match the code default; see WAN guidance below
DATABASE_SSL=false       # Set true for cloud PostgreSQL
```

> #3279: that `false` is the on-host case, and it is the one value of this variable that
> no template shows — `deploy/.env.production` and `.env.example` both ship `true`, and
> `ecosystem.config.cjs` pins `'true'` for all three pm2 apps. `false` is only correct
> for a PostgreSQL on the same box that has no TLS configured; the pool uses TLS unless
> the value is exactly `'false'` (`lib/db/ssl-config.ts:33`), and the server certificate
> is verified only when `NODE_ENV=production` (lines 36–38), so a host deploy that forgets
> `NODE_ENV` gets neither. Keep the `sslmode` in `DATABASE_URL` consistent with
> `DATABASE_SSL` — `prod:preflight` now fails the specific contradiction
> (`DATABASE_SSL=true` with `sslmode=disable`) instead of trusting the copied file.

Every API request handled by `withApiRoute`/`withTenantScope` pins ONE pool client for its whole lifetime (`withPinnedConnection`, #1615), so the pool size must cover _concurrent in-flight requests_, not just DB queries. A dashboard mount alone fans out to 10–15 endpoints; a small pool (e.g. 5) against a WAN/cloud-hosted Postgres turns every mount into a connection queue behind ~1.7 s round-trips (#1972). Keep `DATABASE_POOL_SIZE` at 20+ for cloud DBs and raise `DATABASE_STATEMENT_TIMEOUT` (default 10 s) only per-query via `withTimeout` rather than globally.

Pool exhaustion causes `Connection terminated due to connection timeout`. Increase pool size if you see this error.

---

## 6. User & Permission Model

| Role                   | Access                                         |
| ---------------------- | ---------------------------------------------- |
| `nucrm` (app user)     | Full access to `nucrm` database only           |
| `postgres` (superuser) | Cluster-wide access — use only for admin tasks |
| Tenant members         | Scoped to their tenant data via RLS            |

Database user `nucrm` is the application user. Never give tenant users direct database access.

---

## 7. Disaster Recovery Plan

### Scenario A: Container crashes, data volume intact

```bash
docker compose down
docker compose up -d    # Data volume re-attaches automatically
```

### Scenario B: Data volume corrupted or lost

```bash
# 1. Restore postgres container without volume
docker compose down -v              # WARNING: removes volume
docker compose up -d                # Fresh empty database

# 2. Restore from latest backup
psql "postgresql://nucrm:..." < latest-backup.sql

# 3. Run migrations to catch any schema drift
npx tsx scripts/migrate.ts
```

### Scenario C: Failed migration

```bash
# Rollback immediately
npx tsx scripts/rollback-migration.ts

# If rollback fails, restore from pre-migration backup
psql "postgresql://nucrm:..." < pre-migration-backup.sql
```

---

## 8. Monitoring

The super admin panel tracks database health:

- **`/superadmin/monitoring`** — Real-time system health badges (DB, App Server, Schema, Uptime)
- **`/superadmin/errors`** — Application error logs with level, code, stack trace, and context
- **`/superadmin/backups`** — Backup status and history
- **`/superadmin/health`** — Dedicated system health page

---

## Quick Reference Card

```bash
# Daily checks
docker ps                          # All containers running?
docker compose logs postgres       # Any DB errors?

# Backup
pg_dump "postgresql://nucrm:..." > backup-$(date +%Y%m%d).sql

# Restore
psql "postgresql://nucrm:..." < backup.sql

# Migration safety
pg_dump "postgresql://nucrm:..." > pre-migration.sql   # Step 1: backup
npx tsx scripts/migrate.ts                               # Step 2: migrate
psql "postgresql://nucrm:..." < pre-migration.sql       # Step 3: rollback if needed
```

---

_Last updated: 2026-06-05_

---

## Row-Level Security (RLS) enforcement (#C1)

Tenant isolation has **two independent halves, and both must hold**:

1. **Policies exist** — every uuid tenant-scoped table has RLS enabled and a
   `tenant_isolation` policy. (Migrations `0015`, `0031`, `0037`, `0039`,
   `0054`, `0059`, `0068`.)
2. **The connecting role is subject to those policies** — this is the half that
   is easy to miss.

> PostgreSQL **exempts a table's owner from its own RLS** unless the table is
> marked `FORCE ROW LEVEL SECURITY`, and any role with `BYPASSRLS` (or a
> superuser) is **always** exempt. So a database can have 160+ policies and
> **zero enforcement** if the app connects as the table owner without FORCE.

### Required production setup — connect as a non-owner role

Provision two roles and have the **application** connect as the non-owner one:

```sql
-- Owner role: owns the schema, runs migrations, may bypass RLS for
-- cross-tenant superadmin/cron work.
CREATE ROLE nucrm_owner LOGIN PASSWORD '...' BYPASSRLS;

-- Application role: NOT the table owner, NO BYPASSRLS -> policies apply to it.
CREATE ROLE nucrm_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA public TO nucrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nucrm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nucrm_app;
```

Then point the app's `DATABASE_URL` at **`nucrm_app`** (never the owner), and run
migrations as `nucrm_owner`. Migration `0068_force_rls_owner.sql` additionally
applies `FORCE ROW LEVEL SECURITY`, so RLS holds even if the app ever connects
as an owner.

### The read-only ops role (#3280 ask 1) — proposed, not provisioned here

Nothing in this repository creates this role: a `BYPASSRLS` grant is a privilege
decision, and the standing rule from **#3246** is that a PR does not apply production
DDL. It is written down so the decision can be made once, deliberately.

```sql
-- Operator role: SELECT only, BYPASSRLS so an on-call count is the real count.
-- NEVER put this in the app's DATABASE_URL — scripts/preflight.ts fails production
-- startup when the connecting role has BYPASSRLS, which is the point.
CREATE ROLE nucrm_ops LOGIN PASSWORD '...' BYPASSRLS;
GRANT USAGE ON SCHEMA public TO nucrm_ops;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nucrm_ops;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO nucrm_ops;
```

Until it exists, the honest alternatives need no new privilege:
`PGOPTIONS='-c app.is_super_admin=true' psql "$DATABASE_URL"` arms the context the
policies already read, and `npm run db:count -- <table>` prints both contexts and says
which one it got (#3280). An operator SQL snippet that does neither is filtered, and a
filtered `0` looks exactly like an empty table.

### Fail-closed startup check

`scripts/preflight.ts` now includes a `db:rls` check that inspects the
connecting role and every uuid tenant-scoped table. It **fails production
startup** (hard blocker) when:

- the connecting role is a superuser or has `BYPASSRLS`, or
- the role owns tables that are not `FORCE ROW LEVEL SECURITY` (policies inert),
  or
- any tenant-scoped table lacks RLS or a `tenant_isolation` policy.

Run it any time against a live DB:

```bash
npm run preflight              # gates prod start (start-production.sh / bootstrap.sh)
npm run db:verify-isolation    # detailed per-table report
```

Outside production these surface as warnings so local/dev (which often connects
as the owner) still boots, but the risk is reported explicitly.

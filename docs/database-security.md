# NuCRM Database Security Guide

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

| Command | Effect |
|---------|--------|
| `docker compose down` | Stops containers, data safe |
| `docker compose restart` | Restarts containers, data safe |
| `docker compose up -d` | Starts/updates containers, data safe |
| `docker compose down && docker compose up -d` | Full restart, data safe |

### DANGEROUS Commands (will WIPE data)

| Command | Effect |
|---------|--------|
| `docker compose down -v` | Removes volumes — **DELETES ALL DATA** |
| `docker volume rm nucrm-enterprise_pgdata` | Same — **DELETES ALL DATA** |
| `docker system prune -a --volumes` | Prunes everything including volumes |

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

| File | Purpose |
|------|---------|
| `lib/restore/backup-parser.ts` | Parses SQL dump into individual statements |
| `lib/restore/backup-verifier.ts` | Checks backup integrity before restore |
| `lib/restore/restore-executor.ts` | Executes targeted restore operations |

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

The app uses a connection pool (default: 5 connections, configurable via `DATABASE_POOL_SIZE`).

```env
DATABASE_POOL_SIZE=10   # Increase for higher traffic
DATABASE_SSL=false       # Set true for cloud PostgreSQL
```

Pool exhaustion causes `Connection terminated due to connection timeout`. Increase pool size if you see this error.

---

## 6. User & Permission Model

| Role | Access |
|------|--------|
| `nucrm` (app user) | Full access to `nucrm` database only |
| `postgres` (superuser) | Cluster-wide access — use only for admin tasks |
| Tenant members | Scoped to their tenant data via RLS |

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

*Last updated: 2026-06-05*

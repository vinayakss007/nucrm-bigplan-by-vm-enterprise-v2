# NuCRM — PostgreSQL Production Management Guide

> **Audience:** System administrators, DevOps, engineers on-call
> **Applies to:** PostgreSQL 16 running in Docker on 8GB VM

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Day-to-Day Operations](#2-day-to-day-operations)
3. [Backup & Restore](#3-backup--restore)
4. [Monitoring & Alerts](#4-monitoring--alerts)
5. [Maintenance Tasks](#5-maintenance-tasks)
6. [Performance Tuning](#6-performance-tuning)
7. [Troubleshooting](#7-troubleshooting)
8. [Emergency Procedures](#8-emergency-procedures)
9. [Migration Management](#9-migration-management)
10. [Security](#10-security)
11. [Reference: Useful SQL Queries](#11-reference-useful-sql-queries)

---

## 1. Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  App (x2)   │────▶│  PgBouncer   │────▶│  PostgreSQL 16  │
│  Next.js    │     │  (pooler)    │     │  (primary only) │
└─────────────┘     └──────────────┘     └─────────────────┘
                                                  │
                                         ┌────────┴────────┐
                                         │  WAL archive    │
                                         │  → MinIO/S3     │
                                         └─────────────────┘
```

### Connection Flow
- App connects via PgBouncer (port 6432) — not directly to PostgreSQL
- PgBouncer pools connections to PostgreSQL (port 5432)
- Max connections: 60 (PostgreSQL) → 120 (PgBouncer transaction mode)
- Superuser reserved: 3 connections for emergency admin access

### Container Names
| Container | Image | Ports |
|-----------|-------|-------|
| `nucrm-postgres` | `postgres:16-alpine` | 127.0.0.1:5432 |
| `nucrm-pgbouncer` | `pgbouncer:latest` | 127.0.0.1:6432 |
| `nucrm-postgres-exporter` | `prometheuscommunity/postgres-exporter` | 9187 |

---

## 2. Day-to-Day Operations

### 2.1 Daily Checks (first thing)

```bash
# 1. Check database is running
docker ps | grep nucrm-postgres

# 2. Check last backup time
docker logs nucrm-cron --since 24h | grep -i backup

# 3. Quick health check
docker exec nucrm-postgres pg_isready -U nucrm

# 4. Check active connections
docker exec nucrm-postgres psql -U nucrm -c "SELECT count(*) FROM pg_stat_activity;"

# 5. Check for slow queries
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE state != 'idle' AND now() - pg_stat_activity.query_start > interval '5 seconds'
  ORDER BY duration DESC;"
```

### 2.2 Weekly Checks

```bash
# 1. Database size
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT pg_database_size('nucrm') / 1024/1024 AS size_mb;"

# 2. Table sizes (top 10)
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT relname AS table_name,
         pg_size_pretty(pg_total_relation_size(relid)) AS total_size
  FROM pg_catalog.pg_statio_user_tables
  ORDER BY pg_total_relation_size(relid) DESC
  LIMIT 10;"

# 3. Bloat check — tables with dead tuples
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT relname, n_dead_tup, n_live_tup,
         round(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_dead_tup DESC
  LIMIT 10;"

# 4. Verify backup integrity
bash deploy/scripts/backup.sh --verify
```

### 2.3 Monthly Checks

```bash
# 1. Run VACUUM ANALYZE on all tables
docker exec nucrm-postgres psql -U nucrm -c "VACUUM ANALYZE;"

# 2. Check for unused indexes
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
  FROM pg_stat_user_indexes
  WHERE idx_scan = 0
  ORDER BY tablename;"

# 3. Review PostgreSQL logs for recurring errors
docker logs nucrm-postgres --since 720h | grep -iE "ERROR|FATAL|PANIC" | sort | uniq -c | sort -rn

# 4. Re-index if needed
docker exec nucrm-postgres psql -U nucrm -c "REINDEX DATABASE nucrm;"
```

### 2.4 Key Metrics Dashboard (Grafana)

Open `http://<SERVER_IP>:3001` and check these panels:
- **Active connections** — should be < 40 (warning) / < 50 (critical)
- **Cache hit ratio** — should be > 99%. If below, increase `shared_buffers`
- **Transaction rate** — baseline transactions/sec; spikes indicate issues
- **Slow queries (>200ms)** — investigate any query appearing regularly
- **Deadlocks** — should be 0. Any deadlock = bug in app code
- **Replication lag** — N/A (single instance; 0 if standby is ever added)

---

## 3. Backup & Restore

### 3.1 Automatic Backups

The cron container runs daily at 02:00 UTC. What it does:
1. `pg_dump` in custom format (`-Fc`) with compression level 6
2. Uploads to MinIO (local S3) bucket `nucrm-backups`
3. Keeps last 5 local copies in `/tmp/nucrm-backups/`

Check status:
```bash
docker logs nucrm-cron --since 24h | grep -i backup
```

### 3.2 Manual Backup

```bash
# Full backup (local + S3)
bash deploy/scripts/backup.sh

# Local only
bash deploy/scripts/backup.sh --local

# Backup files are saved to:
ls -lh /tmp/nucrm-backups/
```

### 3.3 Restore from Backup

```bash
# IMPORTANT: This overwrites the current database. Take a backup first!

# 1. Find the backup file
ls -lt /tmp/nucrm-backups/

# 2. Restore
bash deploy/scripts/backup.sh --restore /tmp/nucrm-backups/nucrm_backup_20260722_020000.sql.gz
```

### 3.4 Point-in-Time Recovery (PITR)

If WAL archiving is configured, you can restore to any point in time:

```bash
# 1. Stop app
docker compose -f deploy/docker-compose.production.yml stop app worker cron

# 2. Restore base backup
docker exec -i nucrm-postgres pg_restore -U nucrm -d nucrm \
  --clean --if-exists < /tmp/nucrm-backups/BASE_BACKUP.sql.gz

# 3. Create recovery.conf in PostgreSQL data dir
#    (set restore_command to fetch WAL from S3, recovery_target_time to desired timestamp)

# 4. Restart PostgreSQL — it will replay WAL to the target time
docker restart nucrm-postgres
```

### 3.5 Backup Verification

```bash
# Manual verification: restore backup to temp DB and check integrity
docker exec nucrm-postgres createdb -U nucrm nucrm_verify
docker exec -i nucrm-postgres pg_restore -U nucrm -d nucrm_verify \
  --clean --if-exists --no-owner < /tmp/nucrm-backups/LATEST.sql.gz
docker exec nucrm-postgres psql -U nucrm -d nucrm_verify -c "
  SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables;"
docker exec nucrm-postgres dropdb -U nucrm nucrm_verify
```

### 3.6 Backup Retention Policy

| Tier | Retention | Location |
|------|-----------|----------|
| Daily | 30 days | MinIO bucket + local disk |
| Weekly | 12 weeks | MinIO bucket |
| Monthly | 6 months | MinIO bucket |
| Yearly | 2 years | MinIO bucket (Glacier) |
| WAL | 30 days | MinIO separate path |

---

## 4. Monitoring & Alerts

### 4.1 Critical Alerts

These alerts will fire via PagerDuty/Telegram:

| Condition | Action |
|-----------|--------|
| Connection pool > 80% | Scale up or investigate leak |
| Any query fails | Check app logs, DB logs |
| Backup fails | Retry, check disk space, check MinIO |
| Disk > 85% | Clean old backups, prune Docker |
| Deadlock detected | Report to dev team |
| Slow query > 5s | Investigate immediately |
| Replication lag (if standby) | Check network, WAL shipping |

### 4.2 Checking Logs

```bash
# PostgreSQL server log
docker logs nucrm-postgres

# PostgreSQL slow queries (logged via postgresql.conf)
docker exec nucrm-postgres cat /var/log/postgresql/postgresql-16-main.log

# App database errors
docker logs nucrm-app-1 2>&1 | grep -i "db\|database\|query\|postgres"

# Backup logs
docker logs nucrm-cron 2>&1 | grep -i backup
```

### 4.3 Prometheus Metrics (Grafana)

Available via Postgres Exporter on port 9187. Key metrics:
- `pg_stat_activity_count` — active connections
- `pg_stat_database_tup_fetched` — read activity
- `pg_stat_database_xact_commit` + `rollback` — transaction health
- `pg_stat_user_tables_n_dead_tup` — bloat tracking

---

## 5. Maintenance Tasks

### 5.1 Vacuum & Analyze

PostgreSQL's autovacuum handles this automatically, but manual vacuum is useful:

```bash
# Full database vacuum (safe to run online, but may cause IO)
docker exec nucrm-postgres psql -U nucrm -c "VACUUM ANALYZE;"

# Aggressive on specific table
docker exec nucrm-postgres psql -U nucrm -c "VACUUM FULL VERBOSE audit_logs;"
# NOTE: VACUUM FULL locks the table. Run during maintenance window.
```

### 5.2 Re-indexing

```bash
# Check index health
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT idx.relname AS index_name,
         pg_size_pretty(pg_relation_size(idx.oid)) AS index_size,
         tab.relname AS table_name
  FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
       JOIN pg_class tab ON tab.oid = i.indrelid
  WHERE idx.relname NOT LIKE 'pg_%'
  ORDER BY pg_relation_size(idx.oid) DESC;"

# Re-index (safe online for most indexes)
docker exec nucrm-postgres psql -U nucrm -c "REINDEX INDEX CONCURRENTLY idx_audit_logs_tenant_id;"
```

### 5.3 Table Statistics Update

```bash
# After large data changes (imports, bulk deletes)
docker exec nucrm-postgres psql -U nucrm -c "ANALYZE;"
```

### 5.4 Disk Space Management

```bash
# Check disk
df -h /var/lib/docker

# Find large PostgreSQL files
docker exec nucrm-postgres du -sh /var/lib/postgresql/data

# Clean old Docker artifacts
docker system prune --volumes -f

# Remove old backups (>30 days)
find /tmp/nucrm-backups -name "*.sql.gz" -mtime +30 -delete
```

---

## 6. Performance Tuning

### 6.1 Current Configuration

The database is tuned for an 8GB VM with 1.5GB allocated to PostgreSQL:

| Parameter | Value | When to Increase |
|-----------|-------|-----------------|
| `shared_buffers` | 384MB | If cache hit ratio < 99% |
| `work_mem` | 4MB | If sort/hash operations spill to disk |
| `maintenance_work_mem` | 96MB | If VACUUM is slow |
| `effective_cache_size` | 1152MB | If OS has free memory |
| `max_connections` | 60 | If you hit connection limit |

### 6.2 Finding Slow Queries

```bash
# Queries running > 5 seconds
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT pid, now() - query_start AS duration, query, state, wait_event
  FROM pg_stat_activity
  WHERE state != 'idle' AND query_start < now() - interval '5 seconds'
  ORDER BY duration DESC;"
```

### 6.3 Missing Index Detection

```bash
# Find sequential scans on large tables (potential missing indexes)
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT relname, seq_scan, seq_tup_read, idx_scan
  FROM pg_stat_user_tables
  WHERE seq_scan > 100 AND seq_tup_read > 10000
  ORDER BY seq_tup_read DESC;"
```

---

## 7. Troubleshooting

### 7.1 "Too many connections"

```bash
# Check current connections
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"

# Kill idle connections (use with caution!)
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state = 'idle' AND pid <> pg_backend_pid();"

# Emergency: increase max_connections (requires restart)
# Edit deploy/postgres/postgresql.conf → max_connections = 100
# Then: docker restart nucrm-postgres
```

### 7.2 Query is stuck / hung

```bash
# Find the blocking PID
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT blocked_locks.pid AS blocked_pid,
         blocked_activity.query AS blocked_query,
         blocking_locks.pid AS blocking_pid,
         blocking_activity.query AS blocking_query
  FROM pg_catalog.pg_locks blocked_locks
  JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_locks.pid = blocked_activity.pid
  JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
  JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_locks.pid = blocking_activity.pid
  WHERE NOT blocked_locks.granted;"

# Kill the blocking query (last resort)
docker exec nucrm-postgres psql -U nucrm -c "SELECT pg_terminate_backend(PID_FROM_ABOVE);"
```

### 7.3 Database is corrupt

```bash
# 1. Stop app
docker compose -f deploy/docker-compose.production.yml stop app worker cron

# 2. Try pg_dump of specific tables that are accessible
docker exec nucrm-postgres pg_dump -U nucrm -t contacts -a nucrm > /tmp/contacts_backup.sql

# 3. If pg_dump fails, restore from last backup
bash deploy/scripts/backup.sh --restore /tmp/nucrm-backups/nucrm_backup_YYYYMMDD_HHMMSS.sql.gz
```

### 7.4 WAL directory growing too large

```bash
# Check WAL size
docker exec nucrm-postgres du -sh /var/lib/postgresql/data/pg_wal

# Force checkpoint to clean WAL
docker exec nucrm-postgres psql -U nucrm -c "CHECKPOINT;"

# If still growing, increase max_wal_size in postgresql.conf
# Current: max_wal_size = 1GB, consider 2GB
```

### 7.5 Replication / WAL Archiving Issues

```bash
# Check WAL archiver status
docker exec nucrm-postgres psql -U nucrm -c "SELECT * FROM pg_stat_archiver;"

# If archiver is stuck, check archive_command in postgresql.conf
```

---

## 8. Emergency Procedures

### 8.1 Database is Down

```bash
# 1. Check container status
docker ps -a | grep nucrm-postgres
docker logs nucrm-postgres --tail 50

# 2. Check disk space
df -h

# 3. Restart container
docker restart nucrm-postgres

# 4. If container won't start, check config
docker logs nucrm-postgres | grep -i "error\|fatal"

# 5. Last resort: rebuild from backup
#    (stop app, restore from latest backup, restart)
```

### 8.2 Accidental Data Deletion

```bash
# IMMEDIATELY stop the app to prevent writes
docker compose -f deploy/docker-compose.production.yml stop app worker cron

# If you know the exact time of deletion:
# Use PITR to restore to the minute BEFORE deletion

# Otherwise, restore from latest full backup
bash deploy/scripts/backup.sh --restore /tmp/nucrm-backups/nucrm_backup_LATEST.sql.gz
```

### 8.3 Complete VM Failure

```bash
# 1. Provision new VM
# 2. Install Docker + docker-compose
# 3. Copy deploy/ directory with .env from secure storage
# 4. Download latest backup from MinIO/S3
# 5. Restore database
# 6. Start all services
# 7. Verify health
```

---

## 9. Migration Management

### 9.1 Running Migrations

```bash
# Normal migration (safe, no downtime)
docker compose -f deploy/docker-compose.production.yml exec app npx tsx scripts/push-db.mts
```

### 9.2 Migration Safety Rules

| Rule | Why |
|------|-----|
| Always backup before migration | Rollback safety net |
| Never use DROP COLUMN without checking app code first | App may reference the column |
| Add columns as NULLABLE, then backfill | Avoids long table locks |
| Use CONCURRENTLY for index creation | No table lock |
| Test migration on staging first | Catch errors early |
| Keep migrations small and focused | Easy to roll back |

### 9.3 If Migration Fails

```bash
# 1. Check what failed
docker logs nucrm-app-1 --tail 20

# 2. Run migration in dry-run mode (if supported)
docker compose -f deploy/docker-compose.production.yml exec app npx tsx scripts/push-db.mts --dry-run

# 3. Fix the issue, then re-run
# 4. If you must roll back: restore from pre-migration backup
```

---

## 10. Security

### 10.1 Access Control

| Access Method | Allowed From | Authentication |
|--------------|--------------|----------------|
| Local Docker | 127.0.0.1 only | Environment variable |
| PgBouncer | 127.0.0.1 only | User/password |
| External | **BLOCKED** by firewall | N/A |

### 10.2 Password Rotation

```bash
# Generate new password
NEW_PW=$(openssl rand -base64 32 | tr -d '\n/+=')

# Change in PostgreSQL
docker exec nucrm-postgres psql -U nucrm -c "ALTER USER nucrm PASSWORD '${NEW_PW}';"

# Update .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PW}|" .env

# Restart services
docker compose -f deploy/docker-compose.production.yml restart app worker pgbouncer
```

### 10.3 Connection Encryption

Connections within Docker are on `127.0.0.1` (Docker's host network). SSL is not required for loopback connections. If PostgreSQL must listen on a public interface, enable SSL in `postgresql.conf`:
```
ssl = on
ssl_cert_file = '/etc/ssl/certs/server.crt'
ssl_key_file = '/etc/ssl/private/server.key'
```

### 10.4 Audit

All schema changes are logged:
```sql
-- View DDL change history
SELECT * FROM public._migration_history ORDER BY applied_at DESC;
```

---

## 11. Reference: Useful SQL Queries

### 11.1 Database Health

```sql
-- Database size
SELECT pg_database_size('nucrm') / 1024/1024 AS size_mb;

-- Cache hit ratio (should be > 99%)
SELECT sum(blks_hit) * 100.0 / (sum(blks_hit) + sum(blks_read)) AS cache_hit_ratio
FROM pg_stat_database WHERE datname = 'nucrm';

-- Transaction commit ratio
SELECT sum(xact_commit) * 100.0 / (sum(xact_commit) + sum(xact_rollback)) AS commit_ratio
FROM pg_stat_database WHERE datname = 'nucrm';

-- Connection count
SELECT count(*) FROM pg_stat_activity;

-- Longest running query
SELECT now() - query_start, query, state FROM pg_stat_activity
WHERE state != 'idle' ORDER BY 1 DESC LIMIT 5;
```

### 11.2 Lock Monitoring

```sql
-- Current locks
SELECT relation::regclass, mode, granted FROM pg_locks
WHERE NOT granted AND relation IS NOT NULL;

-- Blocked queries
SELECT pid, wait_event_type, wait_event, query
FROM pg_stat_activity WHERE wait_event IS NOT NULL;
```

### 11.3 Table Statistics

```sql
-- Table sizes with bloat
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total,
       n_live_tup, n_dead_tup,
       CASE WHEN n_live_tup > 0
         THEN round(n_dead_tup * 100.0 / n_live_tup, 2)
         ELSE 0
       END AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- Index usage
SELECT schemaname, tablename, indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
ORDER BY idx_scan;
```

### 11.4 Vacuum Status

```sql
-- Last vacuum on each table
SELECT relname, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY last_autovacuum NULLS FIRST;
```

---

## Quick Reference Cards

### Daily (2 minutes)
```bash
docker ps | grep nucrm-postgres
docker logs nucrm-cron --since 24h | grep -i backup
docker exec nucrm-postgres pg_isready -U nucrm
```

### Weekly (5 minutes)
```bash
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT pg_database_size('nucrm')/1024/1024 AS size_mb,
         (SELECT count(*) FROM pg_stat_activity) AS connections,
         (SELECT round(sum(blks_hit)*100.0/NULLIF(sum(blks_hit)+sum(blks_read),0),1)
          FROM pg_stat_database WHERE datname='nucrm') AS cache_hit_pct;"
```

### Emergency (30 seconds)
```bash
# Database down
docker restart nucrm-postgres

# Need restore
bash deploy/scripts/backup.sh --restore /tmp/nucrm-backups/nucrm_backup_LATEST.sql.gz

# Too many connections
docker exec nucrm-postgres psql -U nucrm -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE state='idle' AND pid<>pg_backend_pid();"
```

---

> **Last updated:** 2026-07-22
> **Maintainer:** DevOps Team
> **Related:** `deploy/DEPLOYMENT_INTERNAL.md`, `deploy/scripts/backup.sh`, `deploy/postgres/postgresql.conf`

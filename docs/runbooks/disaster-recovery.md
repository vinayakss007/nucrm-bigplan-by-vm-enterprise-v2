# Disaster Recovery Runbook

## Overview

This runbook covers recovery procedures for NuCRM's critical infrastructure failures.
Follow these steps in order during an incident.

**Contacts:** On-call engineer via PagerDuty | Slack #incidents | Database admin

---

## 0. Operator tooling — day-to-day + break-glass

One CLI wraps every backup/restore/verify action (thin wrapper over the tested
`scripts/*.ts`). Run from the app directory with the environment loaded.

```bash
npm run dr status                 # DR readiness at a glance: latest backup age,
                                  #   verified?, off-site?  (exit 1 if AT RISK)
npm run dr list --limit 20        # recent backup_records (id, type, size, when, verified)
npm run dr backup                 # create a backup now (pg_dump + off-site upload + retention)
npm run dr verify [--id <uuid>]   # PROVE a backup restores (into a throwaway scratch DB)
npm run dr restore <flags>        # recover — see below
```

**Restore (destructive — guarded):** delegates to `scripts/restore-db.ts`, which
verifies checksum, decrypts if needed, refuses to clobber the live/catalog DB,
and refuses a non-empty target unless told otherwise.

```bash
# Dry run first — locate + checksum + decrypt only, never writes:
TARGET_DATABASE_URL=postgres://user:pass@host:5432/nucrm_restore \
  npm run dr restore --latest --dry-run

# Real recovery into a fresh DB (requires --confirm):
TARGET_DATABASE_URL=postgres://user:pass@host:5432/nucrm_restore \
  npm run dr restore --id <uuid> --confirm
```

### Startup preflight

The app runs `scripts/preflight.ts` before `next start` (via
`scripts/start-production.sh`). It refuses to boot if a critical dependency is
missing — required env + secret strength, DB reachability, migrations applied,
TLS in prod, Redis (when configured), email, and off-site backup storage.

```bash
npm run preflight                 # run the checks manually (respects NODE_ENV)
STRICT=true npm run preflight     # treat warnings as failures too
```

If you must start despite a failure (emergency only): `PREFLIGHT_SKIP=true`.

---

## 1. Database Failure

### Symptoms

- API returns 500 errors across all endpoints
- Health check at `/api/health` shows `database: false`
- Connection pool exhausted logs in Loki

### Recovery Steps

1. **Verify the failure:**

   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   # If this fails, DB is down
   ```

2. **Check managed DB status:**
   - Neon: https://console.neon.tech → project → check compute status
   - RDS: AWS Console → RDS → check instance status

3. **If compute is suspended (Neon):**

   ```bash
   # Any query will auto-wake the compute
   psql $DATABASE_URL -c "SELECT NOW()"
   ```

4. **If DB is corrupted / needs restore:**

   ```bash
   # Get latest backup ID
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://your-app.com/api/system/backup-status

   # Restore from backup (superadmin only, rate-limited to 1/hr)
   curl -X POST https://your-app.com/api/superadmin/restore \
     -H "Content-Type: application/json" \
     -d '{"backup_id": "BACKUP_UUID", "confirm_restore": true}'
   ```

5. **If Point-in-Time Recovery needed:**
   - Neon: Use branch restore to specific timestamp
   - RDS: Create new instance from automated backup → point-in-time

### Expected Recovery Time

- Suspended compute: 5-15 seconds
- Full restore from backup: 15-30 minutes
- PITR: 10-20 minutes

---

## 2. Redis Failure

### Symptoms

- Rate limiting stops working
- Feature flags return defaults
- Realtime notifications stop
- BullMQ jobs stop processing

### Recovery Steps

1. **Check Redis health:**

   ```bash
   redis-cli -u $REDIS_URL PING
   ```

2. **If connection refused:**

   ```bash
   # Docker environment
   docker compose restart redis

   # Check Redis memory
   redis-cli -u $REDIS_URL INFO memory
   ```

3. **If memory exhausted (OOM):**
   - Redis is configured with `maxmemory-policy allkeys-lru`
   - It will auto-evict old keys
   - If still full, flush non-critical cache:

   ```bash
   redis-cli -u $REDIS_URL --scan --pattern "cache:*" | xargs redis-cli DEL
   ```

4. **Impact assessment:**
   - App continues working without Redis (graceful degradation)
   - Cache falls back to in-memory
   - Feature flags use defaults
   - Rate limiting uses in-memory fallback
   - BullMQ queues resume when Redis returns

---

## 3. Application Failure

### Symptoms

- Nginx returns 502 Bad Gateway
- Health check at `/api/health` times out
- Container restarts repeatedly

### Recovery Steps

1. **Check container status:**

   ```bash
   docker compose ps
   docker compose logs web --tail=50
   ```

2. **If OOM killed:**

   ```bash
   # Increase memory limit
   docker compose up -d web  # restarts with existing config
   ```

3. **If startup crash loop:**

   ```bash
   # Check for missing env vars
   docker compose config | grep -i "required"

   # Roll back to previous image
   docker compose pull web
   docker compose up -d web
   ```

4. **If all replicas down:**
   ```bash
   docker compose up -d --force-recreate web
   ```

---

## 4. Object Storage (S3/MinIO) Failure

### Symptoms

- File uploads fail
- Document downloads return 500
- Health check shows `storage: false`

### Recovery Steps

1. **Check storage health:**

   ```bash
   curl -f http://localhost:9000/minio/health/live
   ```

2. **If MinIO is down (dev only):**

   ```bash
   docker compose restart minio
   ```

3. **Production (AWS S3/R2):**
   - Check AWS Health Dashboard
   - Files are durable (99.999999999%) — actual loss is nearly impossible
   - If endpoint unreachable, check VPC/security group settings

---

## 5. Verification After Recovery

After any recovery action, verify the system:

```bash
# 1. Health check
curl https://your-app.com/api/health

# 2. Audit chain integrity
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://your-app.com/api/system/audit-verify

# 3. Worker health
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://your-app.com/api/system/worker-health

# 4. Backup status
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://your-app.com/api/system/backup-status
```

---

## Recovery Targets

| Metric                         | Target                        | Current                  |
| ------------------------------ | ----------------------------- | ------------------------ |
| RPO (Recovery Point Objective) | < 5 minutes                   | WAL archiving every 5min |
| RTO (Recovery Time Objective)  | < 30 minutes                  | Automated restore        |
| Backup frequency               | Daily full + continuous WAL   | Daily cron               |
| Backup retention               | 30 daily, 12 weekly, 2 yearly | Configured               |
| Backup verification            | After every backup            | Automated                |

---

## Escalation Path

1. **L1 (0-5 min):** Auto-healing (container restart, Redis reconnect)
2. **L2 (5-15 min):** On-call engineer investigates, follows this runbook
3. **L3 (15-30 min):** Database admin engaged for restore/PITR
4. **L4 (30+ min):** CTO notified, customer communication if data loss suspected

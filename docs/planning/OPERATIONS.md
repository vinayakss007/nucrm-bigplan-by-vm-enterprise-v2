# NuCRM — Operations, Error Tracking & Simulation Guide

> **Purpose**: How to see what's happening in production, catch errors, trace issues, and simulate failures to verify everything works.

---

## 🎯 User Entry Flow (What Happens First)

```
1. Deploy starts → docker-compose up
2. App boots → instrumentation.ts validates env + inits Sentry
3. First visit → /setup (if no super-admin exists)
   └─ POST /api/setup/create-admin
      └─ Creates super-admin user
      └─ Redirects → /auth/login
4. Login → POST /api/auth/login
   └─ Creates JWT session
   └─ Redirects → /tenant/dashboard
5. Dashboard checks onboarding
   └─ Not onboarded → /tenant/onboarding (4-step wizard)
   └─ Onboarded → Shows dashboard
```

### First-Time Access URLs

| Step | URL | What happens |
|------|-----|--------------|
| 1 | `https://crm.yourdomain.com/setup` | Enter SETUP_KEY, create admin |
| 2 | `https://crm.yourdomain.com/auth/login` | Login with created account |
| 3 | `https://crm.yourdomain.com/tenant/onboarding` | Pick template, install modules |
| 4 | `https://crm.yourdomain.com/tenant/dashboard` | You're live! |

---

## 🔍 Error Tracking Architecture

### How Errors Flow

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER (Client)                                           │
│                                                             │
│  React Error Boundary ──→ Sentry.captureException()         │
│  (global-error.tsx)        (instrumentation-client.ts)      │
│                                                             │
│  fetch() fails ──→ toast error shown to user                │
│  (no Sentry)       (client-side only)                       │
└─────────────────────────────────────────────────────────────┘
         │ HTTP Request
         ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER (API Routes)                                        │
│                                                             │
│  Route handler throws ──→ apiError() ──→ Sentry (500+)     │
│                           └─ console.error                  │
│                           └─ JSON response to client        │
│                                                             │
│  Unhandled in request ──→ onRequestError (instrumentation)  │
│                           └─ Sentry.captureRequestError()   │
│                                                             │
│  logError() ──→ error_logs table (DB)                       │
│  logger.error() ──→ stdout JSON + nucrm.log file           │
│  devLogger.error() ──→ Sentry (prod) / console (dev)       │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  SENTRY DASHBOARD                                           │
│                                                             │
│  Issues tab ──→ grouped errors with stack traces            │
│  Performance ──→ slow transactions, P95 latency             │
│  Session Replay ──→ video of user session on error          │
│  Alerts ──→ email/Slack/Telegram when threshold hit         │
└─────────────────────────────────────────────────────────────┘
```

### What Goes Where

| Error Type | Where it appears | How to find it |
|------------|-----------------|----------------|
| React crash (client) | Sentry Issues | Filter: `service:nucrm-app` |
| API 500 error | Sentry Issues + Docker logs | `docker logs nucrm-app-1` |
| Slow API (>500ms) | Sentry Performance + Grafana | Performance → Transactions |
| DB query failure | Docker logs + error_logs table | `docker logs nucrm-app-1 \| grep "db-pool"` |
| Worker crash | Docker logs + Sentry | `docker logs nucrm-worker` |
| Cron failure | Docker logs | `docker logs nucrm-cron` |
| Auth failure (brute force) | DB: brute_force_attempts table | Super-admin panel |
| Email send failure | Docker logs (worker) | Worker logs + email_tracking table |

---

## 🧪 SIMULATION: Test Everything Works

### Test 1: Verify Sentry is Connected

```bash
# Hit the health endpoint with test flag
curl "https://crm.yourdomain.com/api/health?test-sentry=true"

# Expected response:
# {"status":"ok","db":"connected","schema_ready":true,"sentry":"test error sent"}

# → Go to Sentry → Issues → you should see "Sentry test error from NuCRM health endpoint"
# If you DON'T see it: check SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN in .env
```

### Test 2: Simulate API Error (Server-Side)

```bash
# Call a protected endpoint without auth → should return 401 (NOT logged to Sentry, that's correct)
curl -s https://crm.yourdomain.com/api/tenant/contacts | jq .
# Expected: {"error":"Authentication required"}

# Call with garbage token → 401
curl -s -H "Authorization: Bearer invalid-token" \
  https://crm.yourdomain.com/api/tenant/contacts | jq .
# Expected: {"error":"Invalid or expired token"}

# These are expected 4xx errors — they should NOT appear in Sentry.
# Only 5xx errors go to Sentry (the apiError() function filters).
```

### Test 3: Simulate Frontend Error (Client-Side)

```bash
# Open browser console on any /tenant/* page and run:
# throw new Error("Simulated frontend crash");

# → global-error.tsx catches it
# → Sentry.captureException fires
# → Check Sentry Issues tab within 30 seconds
```

### Test 4: Verify Logging Pipeline

```bash
# Check app logs (structured JSON)
docker logs nucrm-app-1 --tail 50 | grep '"level"'

# Check worker logs
docker logs nucrm-worker --tail 20

# Check cron logs
docker logs nucrm-cron --tail 10

# Look for errors specifically
docker logs nucrm-app-1 2>&1 | grep -i "error\|fail\|fatal" | tail -20

# Check the file-based log (if mounted)
docker exec nucrm-app-1 cat /app/nucrm.log 2>/dev/null | tail -20
```

### Test 5: Verify Database Connectivity

```bash
# Health endpoint tells you DB status
curl -s https://crm.yourdomain.com/api/health | jq '.db, .schema_ready'
# Expected: "connected" true

# If "disconnected": check DATABASE_URL in .env
# If "error": check postgres container is healthy
docker exec nucrm-postgres pg_isready -U nucrm
```

### Test 6: Verify Redis Connectivity

```bash
docker exec nucrm-redis redis-cli ping
# Expected: PONG

# Check worker can connect
docker logs nucrm-worker 2>&1 | grep -i "redis"
# Expected: "[Worker] Redis connected successfully"
```

### Test 7: Verify Email Sending

```bash
# Trigger a password reset (this sends an email)
curl -s -X POST https://crm.yourdomain.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"your-admin-email@example.com"}'

# Check worker logs for email send
docker logs nucrm-worker 2>&1 | grep -i "email"

# If no email arrives:
# 1. Check RESEND_API_KEY is set in .env
# 2. Check worker logs for errors
# 3. Check Resend dashboard (resend.com) for delivery status
```

### Test 8: Verify S3/MinIO Storage

```bash
# Check MinIO health
curl -s http://localhost:9000/minio/health/live
# Expected: returns 200

# Check buckets exist
docker exec nucrm-minio mc ls local/
# Expected: nucrm-backups/ and nucrm-documents/

# Test upload (via the app)
# → Go to /tenant/documents → Upload a file → Should succeed
```

### Test 9: Verify Monitoring Stack

```bash
# Prometheus
curl -s http://localhost:9090/-/healthy
# Expected: "Prometheus Server is Healthy."

# Grafana
curl -s http://localhost:3001/api/health
# Expected: {"database":"ok"}

# Check Prometheus has targets
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets | length'
# Expected: 4 (app, postgres, redis, node)
```

### Test 10: Verify Cron Jobs Fire

```bash
# Manually trigger a cron job
docker exec nucrm-cron /usr/local/bin/run-cron.sh task-reminders

# Check app received it
docker logs nucrm-app-1 --tail 5 | grep "cron\|task-reminders"

# Watch cron logs for next scheduled run
docker logs -f nucrm-cron
```

### Test 11: Full Signup-to-Dashboard Flow

```bash
# 1. Open https://crm.yourdomain.com/setup (first time only)
# 2. Enter SETUP_KEY from .env
# 3. Create admin account
# 4. Login at /auth/login
# 5. Complete onboarding wizard
# 6. Arrive at dashboard
# 7. Create a contact, deal, task
# 8. Check Sentry Performance tab → you should see transactions

# If /setup says "already setup": an admin already exists
# Login at /auth/login directly
```

---

## 📊 Sentry Setup — Complete Checklist

### Configure Sentry

1. Go to [sentry.io](https://sentry.io) → Create Project (Next.js)
2. Copy the DSN
3. Set in `.env`:
   ```
   SENTRY_DSN=https://xxxx@o123.ingest.sentry.io/456
   NEXT_PUBLIC_SENTRY_DSN=https://xxxx@o123.ingest.sentry.io/456
   SENTRY_ORG=your-org-slug
   SENTRY_PROJECT=nucrm
   SENTRY_AUTH_TOKEN=sntrys_xxx  (Settings → Auth Tokens → Create)
   SENTRY_ENABLE=true
   SENTRY_TRACES_SAMPLE_RATE=0.1
   ```

### Configure Sentry Alerts (Recommended)

In Sentry dashboard → Alerts → Create Alert:

| Alert | Condition | Action |
|-------|-----------|--------|
| New errors | When new issue first seen | Email + Slack |
| Error spike | >10 events in 5 minutes | Email + Slack + PagerDuty |
| Slow transaction | P95 > 2000ms for 5 minutes | Email |
| Crash free rate | Below 99% in 1 hour | Email + Slack |

### What Sentry Captures Automatically

- ✅ All unhandled server errors (via `onRequestError`)
- ✅ All React crashes in `global-error.tsx` and `app/tenant/error.tsx`
- ✅ All API 500 errors (via `apiError()` helper)
- ✅ Performance traces (10% of requests)
- ✅ Session replays (10% normal, 100% on error)
- ✅ Router transitions (client-side navigation timing)

### What Sentry Does NOT Capture (by design)

- ❌ 4xx client errors (400, 401, 403, 404) — too noisy
- ❌ Health check requests (`/api/health` filtered)
- ❌ Browser extension errors (chrome-extension://)
- ❌ Network errors ("Failed to fetch") — user's network, not our bug

---

## 📊 Grafana Setup — What to Monitor

### Access Grafana

```
URL: http://your-server-ip:3001
User: admin
Password: (GRAFANA_ADMIN_PASSWORD from .env)
```

### Import Community Dashboards

In Grafana → Dashboards → Import:

| Dashboard | ID | What it shows |
|-----------|-----|---------------|
| Node Exporter Full | 1860 | CPU, RAM, disk, network |
| PostgreSQL Database | 9628 | Connections, queries, locks |
| Redis Dashboard | 763 | Memory, keys, hit rate |

### Key Metrics to Watch

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| CPU usage | <50% | >70% | >85% |
| RAM usage | <60% | >80% | >90% |
| Disk usage | <60% | >75% | >85% |
| PG connections | <30 | >40 | >50 |
| PG query time P95 | <100ms | >500ms | >2000ms |
| Redis memory | <300MB | >400MB | >450MB |
| App response P95 | <200ms | >500ms | >2000ms |
| Error rate | <0.1% | >1% | >5% |

---

## 🔧 Troubleshooting Guide

### "I deployed but see no errors in Sentry"

1. Check `SENTRY_DSN` is set: `docker exec nucrm-app-1 printenv | grep SENTRY`
2. Test manually: `curl "https://your-domain/api/health?test-sentry=true"`
3. Check Sentry project is correct org/project
4. Check `SENTRY_ENABLE` is not `false`

### "Grafana shows no data"

1. Check Prometheus has targets: `curl localhost:9090/api/v1/targets`
2. Check exporters are running: `docker ps | grep exporter`
3. Verify datasource in Grafana → Settings → Data Sources → Prometheus → Test

### "Emails not sending"

1. Check `RESEND_API_KEY` is set
2. Check worker is running: `docker ps | grep worker`
3. Check worker logs: `docker logs nucrm-worker --tail 20`
4. Try manual send: Go to app → invite a user → check worker logs

### "Worker keeps crashing"

1. Check Redis: `docker exec nucrm-redis redis-cli ping`
2. Check worker logs: `docker logs nucrm-worker`
3. Look for "FATAL: REDIS_URL is not set" → fix .env
4. Look for "Redis connection failed after 20 retries" → Redis container might be OOM

### "App returns 500 on every request"

1. Check DB: `docker exec nucrm-postgres pg_isready -U nucrm`
2. Check app logs: `docker logs nucrm-app-1 --tail 30`
3. Look for "DATABASE_URL is required" → .env missing
4. Look for "Environment validation failed" → check required env vars
5. Run migrations: `docker exec nucrm-app-1 npx tsx scripts/migrate.ts`

---

## 🔄 Daily Operations Checklist

### Morning Check (2 minutes)

```bash
# Run health check script
bash deploy/scripts/health-check.sh

# Quick Sentry check — any new unresolved issues?
# → Open Sentry → Issues → Sort by "First Seen" → Last 24h

# Quick Grafana check — any firing alerts?
# → Open Grafana → Alerting → Alert Rules
```

### Weekly Review (15 minutes)

1. **Sentry**: Review and resolve/ignore accumulated issues
2. **Grafana**: Check resource trends (growing memory? disk filling?)
3. **Backups**: Verify latest backup exists in MinIO: `docker exec nucrm-minio mc ls local/nucrm-backups/db/ | tail -3`
4. **Disk**: `df -h /` — below 75%?
5. **Updates**: `docker images | grep nucrm` — when was last build?

---

## 🚨 Known Gaps (To Fix Over Time)

| Gap | Severity | Workaround |
|-----|----------|------------|
| Most error.tsx files don't report to Sentry | Medium | `global-error.tsx` catches bubbled-up errors; fix by adding `Sentry.captureException` to each |
| No `unhandledRejection` handler in app process | Medium | Next.js `onRequestError` covers HTTP; for worker, the process exits on crash (Docker restarts it) |
| Error messages visible to end users | Low | Production never shows stack traces; some `error.message` strings could be cleaner |
| Logging inconsistency (devLogger vs logger vs console) | Low | Both work; `logger` is structured JSON, `devLogger` is colored dev; both route to Sentry in prod |
| No centralized request-ID auto-correlation | Low | `lib/request-id.ts` exists but isn't applied as global middleware; nginx adds `X-Request-ID` |

---

## 📋 Quick Reference — "Where Do I Look?"

| I want to see... | Go to... |
|-------------------|----------|
| All errors (code bugs) | Sentry → Issues |
| Performance bottlenecks | Sentry → Performance |
| What user was doing when error happened | Sentry → Issues → Click issue → Session Replay |
| Server resource usage (CPU/RAM/disk) | Grafana → Node Exporter dashboard |
| Database health | Grafana → PostgreSQL dashboard |
| Redis health | Grafana → Redis dashboard |
| Real-time app logs | `docker logs -f nucrm-app-1` |
| Worker/queue logs | `docker logs -f nucrm-worker` |
| Cron job execution | `docker logs -f nucrm-cron` |
| Audit trail (who did what) | Super-admin → `/superadmin/audit` |
| Login attempts & brute force | DB: `brute_force_attempts` table |
| Email delivery status | Resend dashboard (resend.com) |
| Backup history | MinIO console (localhost:9001) |

# NuCRM — Deployment Blockers & Tracking

> **Last audited:** 2026-05-29
> **Status:** ✅ DEPLOYABLE — all P0 and P1 blockers resolved

---

## ✅ P0 — DEPLOYMENT BREAKERS (all resolved)

| # | Issue | Status | Resolution |
|---|-------|--------|------------|
| **P0-1** | `drizzle-orm` in `devDependencies` | ✅ FIXED | Moved to `dependencies` in package.json |
| **P0-2** | `scripts/cron-scheduler.ts` missing | ✅ FIXED | File created with full interval-based scheduler |
| **P0-3** | Migrations 0008 + 0009 not in `_journal.json` | ✅ FIXED | Journal entries added for 0008, 0009, and 0010 |
| **P0-4** | Duplicate migration prefixes | ✅ FIXED | Orphan files removed; journal is sequential 0000-0010 |
| **P0-5** | Dockerfile invalid `RUN COPY` syntax | ✅ FIXED | Replaced with proper `COPY --from=builder` directives |

---

## ✅ P1 — RUNTIME FAILURES (all resolved)

| # | Issue | Status | Resolution |
|---|-------|--------|------------|
| **P1-1** | `/api/cron/subscription-check` route missing | ✅ FIXED | Route created at `app/api/cron/subscription-check/route.ts` |
| **P1-2** | Build still fails on main (78 TS errors) | ✅ FIXED | TypeScript errors resolved; build passes |
| **P1-3** | `middleware.ts` still exists on main | ✅ FIXED | Renamed to `proxy.ts` |
| **P1-4** | Email silently fails in production | ✅ FIXED | Startup uses `initEnv()` which logs FATAL warning if no email provider configured |
| **P1-5** | Worker requires Redis — no graceful degradation | ✅ FIXED | Worker has retryStrategy with exponential backoff + reconnectOnError + connection event handlers |

---

## 🟢 P2 — SHOULD FIX BEFORE PRODUCTION (non-blocking but risky)

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| **P2-1** | No Zod validation on most API inputs | Malformed requests can crash routes or inject bad data | Add `z.parse()` to POST/PATCH handlers |
| **P2-2** | `ignoreBuildErrors` is CI-only but confusing | `next.config.mjs` has `ignoreBuildErrors: process.env.CI === 'true'` — benign but misleading | Remove entirely after PR #31 fixes all TS errors |
| **P2-3** | No API rate limit on all tenant endpoints | DDoS / abuse risk | The proxy/middleware has per-IP limits but many routes lack per-user throttling |
| **P2-4** | `lib/cache/index.ts` returns `null as any` for missing Redis | Future code additions could NPE | Return a proper NullCache object implementing the interface |
| **P2-5** | Test coverage ~50% | Low confidence in refactors | Target 70%+ on critical paths (`lib/auth/`, `lib/db/`, API routes) |
| **P2-6** | No OpenAPI/Swagger documentation | SDK consumers have no contract | Generate from route handlers or add manual spec |
| **P2-7** | `DATABASE_SSL=false` in all Docker configs | Fine for Docker-internal, but if using external managed DB (RDS, Supabase) needs `true` | Document clearly; auto-detect based on `DATABASE_URL` containing `.amazonaws.com` etc. |

---

## 📋 PRE-DEPLOY CHECKLIST

Run through before EVERY deployment:

### Before First Deploy
- [ ] All P0 items above are resolved
- [ ] `.env` file created from `deploy/.env.production` with ALL `<<<REQUIRED>>>` values filled
- [ ] `bash deploy/generate-secrets.sh` run and values copied
- [ ] SSL certificates in `deploy/nginx/ssl/` (at minimum self-signed)
- [ ] Docker installed and running
- [ ] Domain DNS pointing to VM IP
- [ ] Firewall: only ports 22, 80, 443 open

### Build Verification
- [ ] `npm run build` succeeds locally (0 TS errors after PR #34 merges)
- [ ] `docker build .` succeeds (image builds without error)
- [ ] `npm run test` — 435 tests pass (2 PG-not-running failures are expected without live DB)

### Post-Deploy Verification
- [ ] `https://your-domain.com/api/health` returns `{"status":"ok","db":"connected","schema_ready":true}`
- [ ] `/setup` page loads (first-time) or login page loads (after setup)
- [ ] Sentry test: `https://your-domain.com/api/health?test-sentry=true` → verify event in Sentry dashboard
- [ ] Grafana loads at `:3001` with Prometheus data flowing
- [ ] MinIO console at `:9001` shows buckets created
- [ ] Send a test email (invite a user or use password reset)
- [ ] Worker health: `docker logs nucrm-worker` shows heartbeat
- [ ] Cron health: `docker logs nucrm-cron` shows no errors

### Weekly Health Check
- [ ] `bash deploy/scripts/health-check.sh` returns all OK
- [ ] Disk usage < 75%
- [ ] Memory usage < 80%
- [ ] Backup completed (check MinIO → nucrm-backups bucket)
- [ ] Sentry: no new unresolved errors
- [ ] Grafana: no firing alerts

---

## 🔄 HOW TO TRACK PROGRESS

### Option A: GitHub Issues (Recommended)

Create one issue per P0/P1 item. Label with `deploy-blocker` and `priority:critical`.

```
Issue title: [P0-1] Move drizzle-orm to dependencies
Issue title: [P0-2] Create scripts/cron-scheduler.ts
Issue title: [P0-3] Add migrations 0008+0009 to journal
Issue title: [P0-4] Clean up duplicate migration files
Issue title: [P1-1] Create /api/cron/subscription-check route
```

### Option B: This File

Update the checkboxes below as items are fixed:

#### P0 Progress
- [x] P0-1 drizzle-orm moved to dependencies
- [x] P0-2 cron-scheduler.ts created (or ecosystem.config.js updated)
- [x] P0-3 journal.json updated with 0008 + 0009 + 0010 entries
- [x] P0-4 orphan migration files cleaned up
- [x] P0-5 Dockerfile invalid syntax fixed

#### P1 Progress
- [x] P1-1 subscription-check cron route created
- [x] P1-2 Build passes (0 TS errors)
- [x] P1-3 middleware.ts renamed to proxy.ts
- [x] P1-4 Startup email provider check added (initEnv)
- [x] P1-5 Worker Redis connection resilience added

---

## 📊 CURRENT STATE SUMMARY

| Metric | Value |
|--------|-------|
| Open PRs | 0 (all merged) |
| TS Errors on main | 0 |
| Build status | ✅ PASSES |
| Test status | ✅ 435 pass (2 expected failures) |
| Migration integrity | ✅ Journal complete (0000–0010) |
| Docker image | ✅ Builds successfully |
| Deployment ready | ✅ YES — all blockers resolved |

---

## 🎯 DEPLOYMENT READY

All P0 and P1 blockers are resolved. To deploy:

```bash
docker compose -f deploy/docker-compose.production.yml up -d
```

After that, verify with:
```bash
bash deploy/scripts/health-check.sh
```

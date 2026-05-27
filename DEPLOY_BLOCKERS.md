# NuCRM — Deployment Blockers & Tracking

> **Last audited:** 2026-05-27
> **Status:** 🔴 NOT DEPLOYABLE until P0 items are fixed

---

## 🔴 P0 — DEPLOYMENT BREAKERS (app won't start)

| # | Issue | File(s) | Impact | Fix |
|---|-------|---------|--------|-----|
| **P0-1** | `drizzle-orm` in `devDependencies` | `package.json:140` | **ALL database queries crash** in production (`npm ci --production` won't install it) | Move `drizzle-orm` and `drizzle-kit` to `dependencies` |
| **P0-2** | `scripts/cron-scheduler.ts` missing | `ecosystem.config.js:118` | PM2 cron process crashes on startup (self-hosted deploys) | Create the file OR remove from ecosystem.config.js |
| **P0-3** | Migrations 0008 + 0009 not in `_journal.json` | `drizzle/migrations/meta/_journal.json` | `scripts/migrate.ts` will NEVER apply `0008_services_contacts_companies.sql` or `0009_audit_hash_chain.sql` — tables missing at runtime | Add entries to journal |
| **P0-4** | Duplicate migration prefixes (0001, 0002, 0003) | `drizzle/migrations/` | Orphan `.sql` files (`0001_functions`, `0002_add_missing_indexes`, `0003_rls_policies`) not in journal but on disk — confuses `drizzle-kit push` | Delete orphans or add to journal in correct order |

---

## 🟡 P1 — RUNTIME FAILURES (features broken, not full crash)

| # | Issue | File(s) | Impact | Fix |
|---|-------|---------|--------|-----|
| **P1-1** | `/api/cron/subscription-check` route missing | `deploy/cron/crontab` references it | Stripe subscription fallback cron fails silently every day at 05:00 | Create `app/api/cron/subscription-check/route.ts` (logic described in merged PR #7) |
| **P1-2** | Build still fails on main (78 TS errors) | Multiple files | `npm run build` fails — Docker image won't build until PR #31 (or #34) merges | Merge PR #34 (integration branch) |
| **P1-3** | `middleware.ts` still exists on main (not renamed to `proxy.ts`) | Root | Next.js 16 deprecation warning; future Next.js 17 will break | Merge PR #34 |
| **P1-4** | Email silently fails in production without providers | `lib/email/service.ts` | Password resets, invites, notifications all fail silently — no error surfaced to user | Add startup check: log FATAL warning if `NODE_ENV=production` and neither `RESEND_API_KEY` nor `SMTP_HOST` is set |
| **P1-5** | Worker requires Redis — no graceful degradation | `worker.ts:11` | If Redis is down, worker crashes immediately with unhandled rejection | Add connection error handler with backoff + log |

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
- [ ] P0-1 drizzle-orm moved to dependencies
- [ ] P0-2 cron-scheduler.ts created (or ecosystem.config.js updated)
- [ ] P0-3 journal.json updated with 0008 + 0009 entries
- [ ] P0-4 orphan migration files cleaned up

#### P1 Progress
- [ ] P1-1 subscription-check cron route created
- [ ] P1-2 PR #34 merged (build passes)
- [ ] P1-3 PR #34 merged (proxy.ts rename)
- [ ] P1-4 Startup email provider check added
- [ ] P1-5 Worker Redis connection resilience added

---

## 📊 CURRENT STATE SUMMARY

| Metric | Value |
|--------|-------|
| Open PRs | 10 (5 mergeable via PR #34, 2 stale, 3 rebased) |
| TS Errors on main | 78 (drops to 0 after PR #34) |
| Build status | 🔴 FAILS (until PR #34 merges) |
| Test status | ✅ 435 pass (2 expected failures) |
| Migration integrity | 🟡 Journal incomplete (missing 0008, 0009) |
| Docker image | 🔴 Won't build (TS errors + missing drizzle-orm) |
| Deployment ready | 🔴 NO — 4 P0 blockers remain |

---

## 🎯 FASTEST PATH TO DEPLOYABLE

1. **Merge PR #34** → fixes build + proxy rename (P1-2, P1-3)
2. **Fix P0-1**: `npm pkg set dependencies.drizzle-orm="^0.45.2"` + `npm pkg set dependencies.drizzle-kit="^0.31.10"` (move from devDeps)
3. **Fix P0-3 + P0-4**: Update `_journal.json`, delete orphan SQL files
4. **Fix P0-2**: Create minimal `scripts/cron-scheduler.ts` (or just update deploy to use Docker cron container instead of PM2)
5. **Fix P1-1**: Create subscription-check route

**Estimated effort: ~2 hours of focused work.**

After that: `docker compose -f deploy/docker-compose.production.yml up -d` will work end-to-end.

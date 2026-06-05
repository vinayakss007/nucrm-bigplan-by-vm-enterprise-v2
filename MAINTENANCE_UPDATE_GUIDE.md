# NuCRM Maintenance & Update Guide

This document covers how to keep NuCRM up-to-date, handle dependency upgrades, and maintain the codebase long-term. Follow this as your standard operating procedure.

---

## 1. Sentry Error Monitoring (Already Configured)

### Setup (already done)
Sentry is integrated via `@sentry/nextjs`. Configuration files:
- `sentry.client.config.ts` — Browser-side error capture + replay
- `sentry.server.config.ts` — Server-side error capture
- `sentry.edge.config.ts` — Edge runtime capture
- `_instrumentation.ts` — Performance traces
- `next.config.mjs` — Source maps upload (when SENTRY_ORG/PROJECT/AUTH_TOKEN set)
- `app/global-error.tsx` — Catches unhandled React errors → sends to Sentry

### Environment Variables
```bash
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx    # Required
SENTRY_ORG=your-org                                  # For source maps
SENTRY_PROJECT=nucrm                                 # For source maps
SENTRY_AUTH_TOKEN=sntrys_xxx                         # For source maps upload
SENTRY_ENABLE=true                                   # Set to "false" to disable
SENTRY_TRACES_SAMPLE_RATE=0.2                        # 20% of requests traced
```

### What Sentry Catches
- Unhandled exceptions (client + server)
- API route errors (via `apiError()` → `Sentry.captureException()`)
- React rendering errors (via `global-error.tsx`)
- Performance traces (API latency, page load)
- Session replay on errors (100% of error sessions recorded)

### Viewing Errors
1. Go to https://sentry.io → Your Project → Issues
2. Filter by: Environment (production/staging), Level (error/fatal)
3. Set up Slack/email alerts for new errors

---

## 2. Dependency Update Strategy

### Schedule
| Frequency | What | How |
|:----------|:-----|:----|
| Weekly | Security patches | `npm audit fix` |
| Monthly | Minor versions | `npx npm-check-updates -u --target minor` |
| Quarterly | Major versions | Manual review + test |
| Immediately | Critical CVEs | `npm audit fix --force` + verify |

### Step-by-Step: Monthly Update Process

```bash
# 1. Create update branch
git checkout main && git pull
git checkout -b chore/deps-update-$(date +%Y%m)

# 2. Check what's outdated
npx npm-check-updates

# 3. Update minor/patch versions (safe)
npx npm-check-updates -u --target minor
npm install

# 4. Run tests
npm run test
npx tsc --noEmit --skipLibCheck

# 5. If tests pass, commit
git add -A && git commit -m "chore(deps): monthly dependency update $(date +%Y-%m)"

# 6. Push and create PR
git push -u origin chore/deps-update-$(date +%Y%m)
```

### Critical Dependencies — Handle With Care

| Package | Why Critical | Update Strategy |
|:--------|:------------|:----------------|
| `next` | App framework | Test in staging first, check migration guide |
| `react` / `react-dom` | UI runtime | Only update together, check breaking changes |
| `drizzle-orm` / `drizzle-kit` | Database | Run `db:push` after update, verify schema |
| `@sentry/nextjs` | Error tracking | Check SDK changelog for breaking changes |
| `ioredis` | Cache/queues | Test Redis connection after update |
| `pg` | Database driver | Test connection pool after update |
| `jose` | JWT auth | Security-critical — update immediately on CVE |
| `bcryptjs` | Password hashing | Security-critical |
| `zod` | Validation | Check if schema APIs changed |
| `tailwindcss` | Styling | Check for class name changes |

---

## 3. Next.js Version Upgrades

### Current: Next.js 16.2.1

### Upgrade Checklist
```bash
# 1. Read the migration guide
# https://nextjs.org/docs/upgrading

# 2. Update Next.js + React
npm install next@latest react@latest react-dom@latest

# 3. Update ESLint config
npm install eslint-config-next@latest

# 4. Run the codemod (if available)
npx @next/codemod@latest <codemod-name>

# 5. Check for breaking changes
npx tsc --noEmit --skipLibCheck
npm run build 2>&1 | head -50

# 6. Test critical paths
npm run test
# Manual test: login, create contact, create deal, checkout
```

### Common Breaking Changes to Watch For
- `app/` router API changes (layout, loading, error conventions)
- `next/image` prop changes
- Middleware API changes
- `serverExternalPackages` config changes
- React Server Component constraints

---

## 4. Node.js Version Upgrades

### Current: Node.js 22.22.2

### When to Upgrade
- Every **even-numbered** LTS release (Node 22 → 24 → 26)
- Check: https://nodejs.org/en/about/previous-releases

### Upgrade Steps
```bash
# 1. Update package.json engines field
"engines": { "node": "24.x.x" }

# 2. Update Dockerfile
FROM node:24-alpine AS base

# 3. Update CI workflow (.github/workflows/ci.yml)
node-version: '24'

# 4. Update local (nvm/fnm)
nvm install 24 && nvm use 24

# 5. Reinstall deps (native modules may need rebuild)
rm -rf node_modules && npm install

# 6. Run full test suite
npm run test && npx tsc --noEmit --skipLibCheck

# 7. Test in staging before production
```

### Things That Can Break
- Native modules (`bcryptjs`, `pg`) — usually fine with pure-JS alternatives
- `crypto` API changes — rare but check Web Crypto vs Node crypto
- ESM vs CJS behavior changes
- `fetch()` behavior (global vs import)

---

## 5. Database Schema Updates

### Adding New Columns/Tables
```bash
# 1. Edit schema in drizzle/schema/*.ts
# 2. Generate migration
npm run db:generate

# 3. Review generated SQL
cat drizzle/migrations/XXXX_*.sql

# 4. Apply to dev
npm run db:migrate

# 5. Test
npm run test

# 6. Apply to production (during maintenance window)
DATABASE_URL=production_url npm run db:migrate
```

### Rules
- NEVER drop columns in the same release that removes code using them
- Use 2-phase approach: (1) stop writing, (2) drop column next release
- Always add `DEFAULT` values for new required columns
- Test migrations on a copy of production data first

---

## 6. Security Updates — Immediate Response

### When npm audit reports a vulnerability:

```bash
# Check severity
npm audit

# Auto-fix (low/moderate)
npm audit fix

# If fix requires major version bump
npm audit fix --force  # Then run tests!

# If no fix available — check if it affects you
# Many vulnerabilities are in dev-only deps or unused code paths
```

### Critical Security Checklist
- [ ] JWT secret rotated every 6 months
- [ ] Sentry DSN is not exposed in client bundles
- [ ] EMERGENCY_RECOVERY_KEY is set and stored securely
- [ ] Database backups running (check `/api/cron/auto-backup`)
- [ ] Rate limits are not too permissive
- [ ] CORS origins are restrictive (not `*` in production)

---

## 7. Performance Monitoring & Tuning

### Monthly Health Check
```bash
# 1. Check database query performance
psql $DATABASE_URL -c "
  SELECT query, calls, mean_exec_time, total_exec_time
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 20;"

# 2. Check Redis memory
redis-cli -u $REDIS_URL INFO memory | grep used_memory_human

# 3. Check PM2 process health
pm2 monit

# 4. Check Sentry for new performance issues
# Go to Sentry → Performance → Slowest Transactions

# 5. Run bundle analysis
npm run analyze:bundle
```

### When to Optimize
| Signal | Action |
|:-------|:-------|
| API P95 > 500ms | Add caching or optimize query |
| Bundle > 300KB gzipped | Lazy load heavy components |
| Memory > 450MB per instance | Check for leaks, add instances |
| Redis > 200MB | Review TTLs, flush stale keys |
| Error rate > 1% | Investigate in Sentry |

---

## 8. Feature Flag Management

### Adding a New Feature Flag
```bash
# 1. Add to .env
FEATURE_NEW_THING=false

# 2. Check in code
if (process.env['FEATURE_NEW_THING'] === 'true') {
  // New feature code
}

# 3. Enable in staging first
# 4. Enable in production after verification
# 5. Remove flag after feature is stable (next release)
```

### Module Gating (preferred over feature flags)
- Use the module system (`lib/modules/gate.ts`) for per-tenant features
- Advantages: per-tenant control, plan-based, no code changes to enable

---

## 9. Release Process

### Standard Release
```bash
# 1. Create release branch
git checkout main && git pull
git checkout -b release/v1.x.x

# 2. Run full verification
npm run test
npx tsc --noEmit --skipLibCheck
npm run build

# 3. Update version in package.json
npm version patch  # or minor/major

# 4. Tag and push
git push origin release/v1.x.x --tags

# 5. Deploy
pm2 reload ecosystem.config.js  # Zero-downtime
# or
docker compose -f docker-compose.scale.yml up -d --build
```

### Hotfix Process
```bash
# 1. Branch from main
git checkout -b hotfix/description

# 2. Fix + test
# 3. Merge to main immediately
# 4. Deploy
pm2 reload ecosystem.config.js
```

---

## 10. Backup & Disaster Recovery

### Automated (already configured)
- Hourly backups via `/api/cron/auto-backup`
- 90-day retention
- Per-tenant + full-platform backup

### Manual Backup Before Risky Operations
```bash
# Database dump
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Or trigger via API
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/auto-backup
```

### Recovery
See `EMERGENCY_RECOVERY.md` for full disaster recovery playbook.

---

## 11. Monitoring Dashboard Checklist

Set up alerts for:
- [ ] Sentry: New error (real-time Slack notification)
- [ ] Uptime: `/api/health` check every 60s (UptimeRobot/Pingdom)
- [ ] Database: Connection pool exhaustion
- [ ] Redis: Memory > 80% of maxmemory
- [ ] Disk: > 80% usage
- [ ] PM2: Process restart count > 5/hour
- [ ] Stripe: Payment failures (webhook → alert)

---

## 12. Quarterly Maintenance Calendar

| Month | Tasks |
|:------|:------|
| **Jan/Apr/Jul/Oct** | Major dep updates, Node.js LTS check, security audit |
| **Feb/May/Aug/Nov** | Performance review, bundle analysis, DB query optimization |
| **Mar/Jun/Sep/Dec** | Documentation review, backup integrity test, load test |

### Annual Tasks
- [ ] Rotate JWT_SECRET (requires all users to re-login)
- [ ] Rotate EMERGENCY_RECOVERY_KEY
- [ ] Review and prune old database backups
- [ ] Update SSL certificates (if self-managed)
- [ ] Review Stripe pricing/plans configuration
- [ ] Audit user permissions and super admin list

---

## Quick Command Reference

```bash
# Tests
npm run test                    # All unit tests
npm run test:e2e                # End-to-end tests
npx tsc --noEmit --skipLibCheck # Type check

# Database
npm run db:migrate              # Run migrations
npm run db:status               # Check migration status
npm run db:generate             # Generate new migration

# Deployment
pm2 start ecosystem.config.js  # Start all processes
pm2 reload web                 # Zero-downtime restart
pm2 scale web +2               # Add 2 more instances
pm2 logs                       # View logs

# Monitoring
npm run analyze:bundle          # Bundle size analysis
npm run logs:errors             # View error logs

# Dependencies
npx npm-check-updates          # Check for updates
npm audit                      # Security audit
npm audit fix                  # Auto-fix vulnerabilities
```

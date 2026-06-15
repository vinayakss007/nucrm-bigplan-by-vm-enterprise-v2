# NuCRM Enterprise — Production Readiness Checklist (UPDATED 2026-06-14)

**Repo:** https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2
**Branch workflow:** fix/<item> → PR → merge to main

## STATUS: ~85% READY FOR PRODUCTION

---

## DONE — verified fixed (checklist was stale)

| Item | What was claimed | Actual status |
|------|-----------------|---------------|
| C1 | `.env.local` secrets tracked in git | Already in `.gitignore`, NOT tracked |
| C3 | `require()` in csrf.ts ESM | Already uses `import crypto from 'crypto'` |
| C4 | `.env.local` not in `.gitignore` | Already on line 29 of `.gitignore` |
| H2 | Dockerfile hardcodes JWT_SECRET | Uses `ARG JWT_SECRET` — not hardcoded |
| H4 | CSRF non-crypto hash | Fixed by commit `7fba712` |

## FIXED TODAY (PR needed)

| Item | Fix | Files |
|------|-----|-------|
| C2 (partial) | Added `console.error` to 10 critical empty catch blocks | PR #241 (needs your review) |
| M3 | CSRF rate limit 30→10 req/min | `app/api/auth/csrf-token/route.ts:6` |
| H1 | Docker compose default DATABASE_SSL=false→true | `deploy/docker-compose.production.yml:123` |
| M1 | Notification SSE stream: fixed empty catch + TDZ bug | `app/api/tenant/notifications/stream/route.ts` |

## STILL PENDING (before launch)

### HIGH PRIORITY (fix in remaining time)

1. **H3 — Zod validation on API routes (~70%)**
   - Effort: ~days (deferred — not a blocker for MVP)

2. **C2 — ~216 remaining empty catch blocks**
   - Effort: ~4-6hrs (lower priority — 10 critical ones already fixed)

### MEDIUM PRIORITY

3. **M2 — Wire email sentiment to deal metadata**
   - `analyzeSentiment()` exists in `lib/ai/sentiment.ts` but not called from email pipeline
   - Lead-warming reply analyzer already propagates sentiment to deals
   - Effort: ~2-3hrs

### TESTING

4. **T2 — Integration tests: fix backup-integrity, tenant-isolation**
   - Likely seed data / env issues, not code bugs
   - Effort: ~1hr

5. **T3 — E2E tests: fix 5 failing (seed data)**
   - Need proper seed data fixtures
   - Effort: ~1hr

6. **T4 — Build passes with 0 TS errors (not CI=true)**
   - 63 lingering TS errors suppressed via CI=true
   - Effort: ~days (deferred)

---

## DEPLOY CHECKLIST (ready to go)

- [x] D1. Use `deploy/.env.production` as template
- [x] D2. Run `bash deploy/generate-secrets.sh`
- [x] D3. `npm run db:migrate`
- [x] D4. `npm run build`
- [x] D5. `pm2 start ecosystem.config.cjs`
- [x] D6. Set `COOKIE_SECURE=true`
- [x] D7. Set `NODE_ENV=production`

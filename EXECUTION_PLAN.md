# NUCRM Enterprise — Execution Plan

**Branch rule:** `fix/<slug>` → PR → test 100% → merge to main. Never push to main directly.

---

## CURRENT STATE (2026-06-20)
- Tests: **1790/1790 pass, 104/104 files** ✅
- All fix branches merged into main ✅
- All planned features built, tested, passing

---

## MERGED BRANCHES ✅

| Branch | Commits | Status |
|--------|---------|--------|
| fix/oom-stability | OOM + widget-wrapper + contact-timeline + type safety | ✅ merged |
| fix/complete-db-migrations | DB migrations 0017-0045, drizzle push | ✅ merged |
| fix/production-readiness-0623 | CORS, notifications RLS, proxy, env | ✅ merged |
| fix/remaining-items-0623 | CSRF rate limit, Docker SSL, SSE stream | ✅ merged |
| fix/batch-2-e2e-useEffect | Unused imports, Function type, useEffect fixes | ✅ merged |
| fix/empty-catch-blocks | Error logging added to 10+ silent catch blocks | ✅ merged |
| fix/notification-system | mountedRef cleanup, stream import, reconnect | ✅ merged |
| fix/useeffect-cleanup | AbortController cleanup across components | ✅ merged |
| fix/hydration-ui-fixes | Sidebar hydration, follow-ups widget fix | ✅ merged |
| fix/json-parse-error-handling | try/catch for JSON.parse in 33 routes | ✅ merged |
| fix/db-singleton-type-safety | DbClient type export, Proxy typing | ✅ merged |
| fix/test-consistency | SMS test import fix, backup parser .mjs | ✅ merged |
| fix/contact-timeline-test | Dynamic dates for relative time | ✅ covered |
| fix/widget-wrapper-test | Widget name header in WidgetShell | ✅ covered |

### Skipped (changes already covered by above merges):
- `fix/missing-fk-references` (FK refs already in schema)
- `fix/ci-migration-table-checks` (table checks already in migration)
- `fix/batch-1-security-quick-wins` (silent catches already added)

---

## DEPLOYMENT CHECKLIST

| Step | Status | Action |
|------|--------|--------|
| Code | DONE | All features built, 1790 tests passing, 0 TS errors |
| Database | NEEDS SETUP | Deploy PostgreSQL (Supabase/Neon/Railway) |
| Redis | NEEDS SETUP | Deploy Redis (Upstash free tier works) |
| S3/R2 | NEEDS SETUP | Create Cloudflare R2 bucket (free 10GB) |
| Stripe | NEEDS CONFIG | Add Stripe keys to .env |
| Domain | NEEDS SETUP | Point domains to Vercel/Railway |
| Sentry | NEEDS CONFIG | Add Sentry DSN to .env |
| Deploy | NEEDS SETUP | `npm run build` + deploy to Vercel/Railway |
| DB Migration | NEEDS RUN | `npm run db:push` after database is connected |
| Seed Data | NEEDS RUN | `npm run db:seed` for plan limits + modules |

---

## PHASE 4+ (Future)
AI Gateway foundation → Auto-Draft → Lead-scoring → At-risk → Summarize
Per `docs/planning/REMAINING_BUILD_PLAN.md`

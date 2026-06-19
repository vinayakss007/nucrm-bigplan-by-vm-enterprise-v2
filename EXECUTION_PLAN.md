# NUCRM Enterprise — Execution Plan

**Branch rule:** `fix/<slug>` → PR → test 100% → merge to main. Never push to main directly.

---

## CURRENT STATE (2026-06-19)
- Tests: **1790/1790 pass, 104/104 files** ✅
- PR #252 (widget-wrapper fix) — open
- PR #253 (contact-timeline fix) — open
- Most NUCRM_FIX_TRACKER items already resolved in prior merges

---

## ROUND 1 — Test fixes ✅ (COMPLETED)

### 1.1 widget-wrapper test — PR #252 ✅
- Added widget name header to WidgetShell component
- All 10 widget-wrapper tests pass

### 1.2 contact-timeline test + integration tests — PR #253 ✅
- Changed mock dates from static to dynamic (now uses `new Date()`)
- All 1790 tests pass, 104/104 test files

### 1.3 E2E tests (5 failing)
- Needs: Running PostgreSQL with migrations applied (0019_add_stage_entered_at.sql)
- Seed script fails with `column "stage_entered_at" does not exist`
- Fix: Run `npm run db:migrate` before seeding, or update playwright.config.ts to run migrations first

---

## ROUND 2 — Security & stability fixes ✅ (AUDITED)

### NUCRM_FIX_TRACKER audit results (2026-06-19):

| Item | Status | Notes |
|------|--------|-------|
| CSRF SameSite mismatch | ✅ Already fixed | Both cookies set to `strict` |
| proxy.ts matches ALL routes | ✅ Already fixed | config.matcher excludes static assets |
| ALLOWED_ORIGINS=* | ✅ Already handled | Production warning + check in code |
| JWT token leaked in response | ✅ Already fixed | Login returns `{ ok, user }` only, no token |
| requireAuth() LEFT JOIN bug | ✅ Already fixed | Super admin check runs before LEFT JOIN |
| No CSRF-token rate limit | ✅ Already fixed | 5 req/min at proxy.ts:137 |
| Notification RLS | ✅ Already fixed | Migrations 0012 + 0016 |
| Legacy ANTHROPIC_API_KEY | ✅ Config cleanup | Non-blocking |
| AI gateway not connected | 🔶 Phase 4 feature | Not a bug |
| **OOM stability** | **⚠️ FIXED** | Added `NODE_OPTIONS=--max-old-space-size=2048` |

---

## ROUND 3 — Code quality

### 3.1 ESLint warning sweep (~2456)
- Branch: `fix/eslint-warnings`
- Fix warnings across the codebase
- Verify: `npm run lint`

### 3.2 63 suppressed TS errors
- Branch: `fix/ts-errors`
- Fix suppressed TypeScript errors
- Verify: `npx tsc --noEmit --pretty`

### 3.3 Zod validation coverage (remaining 30%)
- Branch: `fix/zod-validation`
- Add input validation to uncovered API routes
- Verify: `npm run test:unit`

---

## PHASE 4+ (after code quality is clean)
AI Gateway foundation → Auto-Draft → Lead-scoring → At-risk → Summarize
Per `docs/planning/REMAINING_BUILD_PLAN.md`

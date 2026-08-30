# TODO — Testing & Bug Fixes (No New Features)

## Focus: Make the existing app solid, not add more

---

## STATUS: July 5, 2026

### Completed

- [x] PR #294 (CSRF/setup) — merged
- [x] PR #295 (contact search) — merged
- [x] PR #296 (email duplicate check + contact_id) — merged
- [x] Fixed deal detail page crash (raw SQL → Drizzle refs)
- [x] Fixed monitoring 500 errors (`captureError` in `'use client'` module)
- [x] Fixed tenant dashboard 429 rate limiting (bypass limiter for widget endpoints)
- [x] Created superadmin tenant detail page
- [x] Created superadmin user detail page
- [x] Full codebase audit: tsc --noEmit clean, next build passes
- [x] **Fixed all critical/high bugs from audit:**
  - trial-check `_daysLeft` → `daysLeft` variable mismatch
  - subscription-check constant-time secret comparison (`verifySecret`)
  - impersonate wrong schema validation removed
  - retry-webhooks / warmup-emails / process-lead-scoring missing try/catch
  - dashboard/stats returning 200 on error → 500
- [x] **Fixed escaped template literals:**
  - task-reminders: email HTML links and text body
  - trial-check: email HTML/text for expiry and warning, activity description
- [x] Added `.next-build/` to `.gitignore`, removed from git tracking
- [x] tsc --noEmit clean, `next build` passes

### All Critical/High/Medium Bugs Fixed ✅

### Remaining: Low Priority

- `app/api/tenant/integrations/route.ts` — hardcoded placeholder webhook URL (cosmetic)
- Browser test: leads, contacts, deals, settings, superadmin pages
- Clean up stale branches

### Commits on main

```
6c3b6af  fix: add .next-build/ to .gitignore
ae4bad4  fix: bypass edge rate limiter for tenant dashboard widget endpoints
357be05  fix: remove captureError from 7 server route handlers (monitoring fix)
3415943  fix: deal detail page crash — proper Drizzle refs, try/catch
5a5a550  feat: superadmin user detail page + fix tenants/[id] plan_name TS error
```

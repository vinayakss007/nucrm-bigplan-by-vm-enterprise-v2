# NuCRM Fix Tracker

**Created**: 2026-06-04
**Rule**: New issues appended at top. Completed items marked [x] — never deleted.

---

## 2026-06-10

- [x] CSRF SameSite mismatch — verified: session cookie already `sameSite: 'strict'` in `lib/auth/session.ts:73`, matches CSRF cookie. No mismatch.
- [x] `proxy.ts` middleware matches ALL routes — verified: `config.matcher` already excludes static assets. Non-API public paths return early before JWT verify (line 159). No issue.
- [x] `ALLOWED_ORIGINS=*` — already set to specific origins in `.env.local` line 35.
- [x] JWT token in login response — verified: login response only returns `{ ok, user }`, token is set via cookie only.
- [x] `/api/auth/` CSRF — verified: public API routes bypass proxy-level CSRF by design (no session yet). Session cookie has SameSite=Strict which mitigates login CSRF. Route handlers implement their own auth.
- [x] `requireAuth()` LEFT JOIN — verified: superadmin handled separately at line 190-203, LEFT JOIN only for regular users.
- [x] No rate limit on `/api/auth/csrf-token` — already has rate limit in `proxy.ts:133` (5 req/min per IP).
- [x] `proxy.ts` naming — Next.js 16 officially renamed middleware.ts → proxy.ts, this is the correct convention.
- [x] Legacy `ANTHROPIC_API_KEY` — removed from `.env.local`.
- [x] Notification system errors — `DATABASE_URL is required` errors from tests, not production. Tests need env loading.
- [x] App keeps crashing (OOM) — `--max-old-space-size=2048` already in Dockerfile:55, docker-compose.yml:47, scripts/start-production.sh:23, package.json, and all production paths.
- [ ] AI gateway still not connected to real LLM providers — `ai_provider_secrets` table has data but no provider API keys configured via admin UI (needs UI implementation)

## 2026-06-04

- [x] CSRF cookie missing Max-Age — was session cookie, lost on browser close. Added `Max-Age=2592000` to `lib/auth/csrf.ts:setCsrfCookie()`. (commit `ae8dd90`)
- [x] Missing AI DB tables — `ai_activity`, `ai_draft_templates`, `at_risk_rules`, `comm_email_drafts` not created. Added migration `0012_missing_ai_tables.sql`.
- [x] App rebuild after fix — `next build` succeeded, app running on port 3000 with compiled fix.

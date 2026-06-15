# NuCRM Fix Tracker

**Created**: 2026-06-04
**Rule**: New issues appended at top. Completed items marked [x] — never deleted.

---

## 2026-06-04

- [x] CSRF cookie missing Max-Age — was session cookie, lost on browser close. Added `Max-Age=2592000` to `lib/auth/csrf.ts:setCsrfCookie()`. (commit `ae8dd90`)
- [x] Missing AI DB tables — `ai_activity`, `ai_draft_templates`, `at_risk_rules`, `comm_email_drafts` not created. Added migration `0012_missing_ai_tables.sql`.
- [x] App rebuild after fix — `next build` succeeded, app running on port 3000 with compiled fix.
- [ ] CSRF SameSite mismatch: session cookie `SameSite=Lax` vs CSRF cookie `SameSite=Strict` — cross-site nav sends session but not CSRF cookie
- [ ] `proxy.ts` middleware matches ALL routes — every request (including images, static assets) hits JWT verify + CSRF check. Add path exclusions.
- [ ] `ALLOWED_ORIGINS=*` in `.env.local` — wide open CORS. Lock to actual domain.
- [ ] JWT token returned in login response body: `{ ok:true, token, ... }` — leaks session token to client JS
- [ ] `/api/auth/` routes completely skip CSRF — `needsCsrfValidation()` returns false for all auth paths including login
- [ ] `requireAuth()` uses `LEFT JOIN + LIMIT 1` — super admin with tenant membership gets tenant-scoped context instead of super admin privileges
- [ ] App keeps crashing (OOM) — 4GB RAM, `next start` dies after serving requests. Need increased swap or reduced heap
- [ ] AI gateway still not connected to real LLM providers — `ai_provider_secrets` table has data but no provider API keys configured via admin UI
- [ ] No rate limit on `/api/auth/csrf-token` — can be spammed by authenticated users (noted in code review)
- [ ] `proxy.ts` has `config.matcher` export but is named `proxy.ts` not `middleware.ts` — Next.js 16 detects it anyway but this is non-standard and could break on version upgrades
- [ ] Legacy `ANTHROPIC_API_KEY` env var in `.env.local` line 44 — dead config, not used by new AI gateway
- [ ] Notification system errors in logs — `Failed to create notification` for every type (contact_assigned, task_assigned, etc.) — likely missing `notifications` table RLS or schema issue

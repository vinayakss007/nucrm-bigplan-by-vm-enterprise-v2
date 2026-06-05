# NuCRM Enterprise — All Issues Combined
**Date:** 2026-06-05
**Source Files:** AUDIT_2026-06-05.md, ISSUES-2026-06-04.md, E2E-FAILURES-2026-06-04.md, ISSUES.md, ALL_ISSUES.md, TEAM_PAGE_ISSUES_FIXED.md

---

## PART 1: CRITICAL SECURITY ISSUES

| # | Issue | Status |
|---|-------|--------|
| 1 | JWT token leaked in login response body (`lib/auth/api-handlers.ts:128-132`) | **OPEN** |
| 2 | Real secrets committed to repo — `.env.local` tracked by git (JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY, CRON_SECRET, SETUP_KEY) | **OPEN** |
| 3 | CSRF exemption for ALL `/api/auth/` routes (`lib/auth/csrf.ts:145`) — code still has it despite docs claiming it was removed | **OPEN** |
| 4 | CSRF "hash" is fake 32-bit hash in Edge Runtime (`lib/auth/csrf.ts:25-31`) — uses `String.hashCode()` not real crypto | **OPEN** |
| 5 | `.env.local` not in `.gitignore` — secrets permanently in git history | **OPEN** |
| 6 | No rate limit on `/api/auth/csrf-token` — can be spammed | **OPEN** |
| 7 | CSRF cookie missing Max-Age | **FIXED** |
| 8 | CSRF SameSite mismatch — session cookie changed to SameSite=Strict (PR #83) | **FIXED** |
| 9 | ALLOWED_ORIGINS=* in .env.local — restricted to localhost, blocked * in production (PR #83) | **FIXED** |
| 10 | JWT token leaked in login response — removed from response (PR #83) | **FIXED** |
| 11 | /api/auth/ routes skip CSRF entirely — removed blanket exemption (PR #83) | **FIXED** |
| 12 | requireAuth() uses LEFT JOIN + LIMIT 1 — super admin now checked first (PR #87) | **FIXED** |
| 13 | proxy.ts matches ALL routes — added more static asset exclusions (PR #85) | **FIXED** |
| 14 | Legacy ANTHROPIC_API_KEY env var — marked deprecated (PR #85) | **FIXED** |
| 15 | CI env secrets hardcoded in cleartext — moved to GitHub Secrets (PR #84) | **FIXED** |
| 16 | Missing AI DB tables (migration 0012) | **FIXED** |

---

## PART 2: HIGH PRIORITY ISSUES

| # | Issue | Status |
|---|-------|--------|
| 17 | 50+ API routes leak `err.message` to production clients — raw error messages expose DB internals, file paths, stack traces | **OPEN** |
| 18 | `require()` used in ESM modules (`lib/auth/csrf.ts:16,35`) — throws ReferenceError in Edge Runtime / Next.js 16 strict ESM | **OPEN** |
| 19 | `ignoreBuildErrors: true` in CI — ships 63 known TypeScript errors to production | **OPEN** |
| 20 | No `.dockerignore` — Docker build context includes `.env.local`, `node_modules`, `.next`, secrets | **OPEN** |
| 21 | `DATABASE_SSL=false` in production configs (`deploy/.env.production:77`, `docker-compose.yml:44`) — DB traffic unencrypted | **OPEN** |
| 22 | Dockerfile hardcodes `JWT_SECRET="build-jwt-secret"` (`Dockerfile:17`) — leaks into runtime image layers | **OPEN** |
| 23 | V2 API Gateway permits wildcard CORS by default (`lib/api/gateway.ts:123`) | **OPEN** |
| 24 | 103+ `.catch(() => {})` silent error swallows — DB ops, webhooks, email, cron, backups silently fail | **OPEN** |
| 25 | 190+ empty `catch {}` blocks — systemically hides all errors across codebase | **OPEN** |
| 26 | `useEffect` without cleanup in 40+ components — memory leaks, state updates on unmounted components, duplicate requests | **OPEN** |
| 27 | Most API routes skip Zod validation — only ~30% use schema validation | **OPEN** |
| 28 | `requireAuth()` wrapped in DB transaction (`lib/auth/middleware.ts:99`) — DB failure = false 401 | **OPEN** |
| 29 | 200+ `as any` type assertions — TypeScript safety defeated in critical paths | **OPEN** |
| 30 | Missing CSP + HSTS security headers (`next.config.mjs:57-90`) | **OPEN** |
| 31 | Grafana admin password defaults to "admin" (`.env.example:85`) | **OPEN** |
| 32 | App keeps crashing (OOM) — fixed with --max-old-space-size=2048 (PR #88) | **FIXED** |
| 33 | Server exposed on 0.0.0.0:3000 — fixed to bind 127.0.0.1 (PR #88) | **FIXED** |
| 34 | High memory usage — mitigated: Node heap limited to 2GB (PR #88) | **FIXED** |
| 35 | 4 unit tests failing — resolved (PR #86 + PR #90) | **FIXED** |

---

## PART 3: MEDIUM PRIORITY ISSUES

| # | Issue | Status |
|---|-------|--------|
| 36 | SQL injection via dynamic table names (`app/api/tenant/custom-fields/route.ts:65,183,191,225`) — `${table}` interpolated directly into SQL | **OPEN** |
| 37 | No error.tsx boundaries on most superadmin pages — crashes blow up whole layout | **OPEN** |
| 38 | Custom TOTP implementation instead of otplib/speakeasy — custom base32 decoder has edge cases | **OPEN** |
| 39 | CSRF token endpoint rate limit too generous — 30 req/min allows spam | **OPEN** |
| 40 | Proxy-based DB singleton loses type safety (`drizzle/db.ts:15-19`) — `as unknown` cast defeats type checking | **OPEN** |
| 41 | GDPR compliance has N+1 query pattern (`lib/compliance/gdpr.ts:56-135`) — 8 sequential queries instead of parallel | **OPEN** |
| 42 | SOC2 compliance same N+1 pattern (`lib/compliance/soc2.ts:122-328`) | **OPEN** |
| 43 | `requestToJson()` swallows JSON parse errors (`app/api/forms/submit/route.ts:200-206`) — invalid JSON becomes `{}` | **OPEN** |
| 44 | Multiple `.json().catch(() => ({}))` patterns — several routes silently default invalid bodies to empty objects | **OPEN** |
| 45 | `verifySecret()` length check timing leak (`lib/crypto.ts:17-19`) — early return on length mismatch leaks secret length | **OPEN** |
| 46 | BigInt serialization risk in metrics (`app/api/metrics/route.ts:101`) — `count(*)::int` may return BigInt on large datasets | **OPEN** |
| 47 | `dangerouslySetInnerHTML` in 5 components (`lib/sanitize.ts:24`) — regex-based HTML stripping (bypassable) | **OPEN** |
| 48 | Mixed ESM/CJS module patterns — various files mix `import` and `require` | **OPEN** |
| 49 | No log rotation for file logger (`lib/logger.ts`) — `nucrm.log` grows unbounded | **OPEN** |
| 50 | Grafana Loki errors silently dropped (`lib/grafana.ts:320`) — `flushLogs()` catch does `console.error` only | **OPEN** |
| 51 | No real-time alerting for errors — no email/webhook/Slack notification for critical errors | **OPEN** |
| 52 | API error handler and logError don't coordinate — `apiError()` sends to Sentry but doesn't persist to `error_logs` table | **OPEN** |
| 53 | `.catch(() => null)` in 6 places — returns silent null on failure | **OPEN** |
| 54 | `.catch(() => [])` in 17 places — returns empty array on failure, indistinguishable from "no results" | **OPEN** |
| 55 | POST /api/superadmin/errors returns 500 with details (`app/api/superadmin/errors/route.ts:112`) — production users see `details` field | **OPEN** |
| 56 | Cron jobs skip CSRF (`lib/auth/csrf.ts:144`) — protected only by secret header | **OPEN** |
| 57 | Server hung/unresponsive — next-server accepting TCP but never sending HTTP responses | **OPEN** |
| 58 | Slow filesystem — .next/dev on slow drive | **OPEN** |
| 59 | Notification system errors — improved error logging (PR #86); likely RLS/FK constraint | **OPEN** |
| 60 | Database sync error — `npm run db:push` fails with TypeError | **OPEN** |
| 61 | AI Sentiment — email processing layer needs to populate `deal.metadata.ai_sentiment.score` | **OPEN** |
| 62 | Missing Server Action — stale client code or deployment mismatch | **OPEN** |
| 63 | Notifications API repeated failures — polling loop failing every 60 seconds | **OPEN** |
| 64 | No Zod validation on many API inputs | **OPEN** |
| 65 | No OpenAPI/Swagger docs | **OPEN** |
| 66 | No branch protection configured on main branch | **OPEN** |
| 67 | DATABASE_SSL=false in Docker configs | **OPEN** |

---

## PART 4: LOW PRIORITY ISSUES

| # | Issue | Status |
|---|-------|--------|
| 68 | No i18n / internationalization — all UI strings hardcoded in English | **OPEN** |
| 69 | `FILTER(Boolean) as string[]` assertion (`components/tenant/settings/sidebar-customize-section.tsx:173`) — hides potential null issues | **OPEN** |
| 70 | Duplicate `jsdom` override (`package.json:153-157`) | **OPEN** |
| 71 | Package name mismatch — `package.json` says `nucrm-saas`, directory/docs say `nucrm-enterprise` | **OPEN** |
| 72 | Unused `ANALYZE=true` bundle config (`next.config.mjs:93-136`) | **OPEN** |
| 73 | Unused `STRIPE_PRICE_ID` placeholders | **OPEN** |
| 74 | Merge conflict markers in git history | **OPEN** |
| 75 | No `.gitignore` entry for `.env.local` | **OPEN** |

---

## PART 5: E2E TEST FAILURES

**5 tests fail out of 24** — all due to missing seed data, not code bugs:

| # | Test | File | Root Cause |
|---|------|------|------------|
| 76 | view contacts list | `tests/e2e/contacts.spec.ts:17` | No contact records seeded for E2E test user |
| 77 | view deals pipeline | `tests/e2e/deals.spec.ts:17` | No pipeline/deal records for test tenant |
| 78 | create new deal | `tests/e2e/deals.spec.ts:22` | No pipeline/stage exists for form |
| 79 | deal pipeline stages visible | `tests/e2e/deals.spec.ts:40` | No pipeline stages seeded |
| 80 | landing/login/signup accessible | `tests/e2e/notifications.spec.ts:36` | Page navigation timeout — redirect loop or slow load |

**Fix:** Extend `scripts/seed-e2e-user.ts` to seed: 1 default pipeline + 6 stages, 5-10 contacts, 3-5 deals.

---

## PART 6: REMAINING FEATURES (Phases 4-10)

### Phase 4 — AI Gateway, Secrets Vault, Activity Log (IN PROGRESS)
- [ ] 81. AI provider secrets table + AES-256-GCM encrypted vault
- [ ] 82. Auto-draft backend (ai_draft_templates table, CRUD, settings)
- [ ] 83. Lead-scoring rules editor (rules table, CRUD, settings UI, cron)
- [ ] 84. At-risk deals (rules table, CRUD, dashboard, daily cron)
- [ ] 85. Summarize-anywhere (entity summarizer API + picker UI)

### Phase 5 — Workflow Completeness
- [ ] 86. Industry templates drive lead-intake forms
- [ ] 87. Per-product "Clients" views filtered by pipeline/lifecycle
- [ ] 88. Unified communications-to-activities (SMS/WhatsApp/email)
- [ ] 89. Bulk action bar on companies/deals/tasks/users
- [ ] 90. BANT custom fields migration path

### Phase 6 — Bulk Operations
- [ ] 91. Bulk add to sequence
- [ ] 92. Bulk add to list/segment
- [ ] 93. Bulk update custom field
- [ ] 94. Bulk note/activity
- [ ] 95. Bulk merge for leads & companies
- [ ] 96. Bulk archive/restore
- [ ] 97. Bulk email send
- [ ] 98. Bulk SMS/WhatsApp send
- [ ] 99. Cross-resource bulk-invite users
- [ ] 100. Bulk role change / deactivate / force-relogin / 2FA-enforce

### Phase 7 — Settings UI Gaps
- [ ] 101. Field-permissions UI grid
- [ ] 102. Saved views list page + share toggle
- [ ] 103. Sidebar pinned-shortcuts server-side persistence
- [ ] 104. Tags Manager extended to deals/tickets metadata
- [ ] 105. Per-team admin-set sidebar override
- [ ] 106. Email signature WYSIWYG
- [ ] 107. default_record_view honoured on every list page
- [ ] 108. confirm_destructive honoured across modals
- [ ] 109. Per-team prefs override layer

### Phase 8 — Super-Admin Operations
- [ ] 110. Settings-drift dashboard
- [ ] 111. Bulk-operation live audit feed
- [ ] 112. OOO heatmap
- [ ] 113. API-key entropy report
- [ ] 114. Email/SMS provider key health UI
- [ ] 115. Provider keys super-admin UI
- [ ] 116. White-label branding super-admin UI
- [ ] 117. Maintenance mode toggle + global feature flags
- [ ] 118. Rate-limits UI
- [ ] 119. Sentry/monitoring keys UI
- [ ] 120. Tenant-onboarding defaults
- [ ] 121. Tenant settings JSONB shape watcher

### Phase 9 — Channels & Integrations
- [ ] 122. WhatsApp 2-way sync
- [ ] 123. Stripe/accounting 2-way sync
- [ ] 124. Voice -> CRM (call recording => transcription => activity => AI summary)
- [ ] 125. LinkedIn/social ingest
- [ ] 126. Calendar 2-way sync (Google/Microsoft)
- [ ] 127. Slack notifications + slash-commands

### Phase 10 — Tech Debt
- [ ] 128. Fix 63 lingering TypeScript errors
- [ ] 129. Fix 2 always-failing integration tests (backup-integrity, tenant-isolation)
- [ ] 130. Fix AWS SDK version mismatch (remove `as any` cast)
- [ ] 131. Document JWT_SECRET requirement at build-time
- [ ] 132. Remove unused STRIPE_PRICE_ID placeholders
- [ ] 133. ESLint warning sweep
- [ ] 134. Generate tmp/ test fixtures at runtime

---

## PART 7: SETUP & CONFIGURATION ISSUES (Historical)

| # | Issue | Fix |
|---|-------|-----|
| 135 | Database Not Running — PostgreSQL container not started | `docker compose up -d postgres redis` |
| 136 | DATABASE_URL used Docker hostname — `postgres` unresolvable outside Docker | Changed to `localhost:5432` |
| 137 | Merge conflicts in Schema files (`drizzle/schema/ai.ts`, `_registry.ts`) | Manually resolved |
| 138 | Node.js Version Mismatch — requires `>=22.0.0`, env has v20.9.0 | Installed TypeScript manually |
| 139 | NODE_ENV set to "production" in development | Overrode with `NODE_ENV=development` |
| 140 | .env.local missing DATABASE_URL | Added DATABASE_URL to `.env` |
| 141 | Cross-Origin Dev Access Blocked — Next.js 16 blocks unknown origins | Added host to `allowedDevOrigins` |
| 142 | No Super Admin User in Database — zero users | Created super admin via SQL insert |

---

## PART 8: PREVIOUSLY FIXED ITEMS

### Team Page Issues (Fixed 2026-05-15)
- **143.** settings-nav.tsx — Admin Check API Mismatch (`isAdmin` vs `is_admin`)
- **144.** Team Page Server Component — Missing Null Checks
- **145.** Team Client Component — Missing State Initialization
- **146.** Build Configuration — TypeScript Errors (`ignoreBuildErrors: true`)
- **147.** Dockerfile — Missing Scripts Directory

### ALL_ISSUES.md Fixes (29 items)
- **148.** security.ts broken import — fixed
- **149.** No DB RLS policies — 20+ CREATE POLICY statements created
- **150.** ignoreBuildErrors: true — now CI-only
- **151.** Missing updatedAt on 5 tables — added
- **152.** Error messages leak internals — centralized apiError() across 60+ routes
- **153.** Only 2 error boundaries — added 18 more
- **154.** Widespread `any` types — fixed contacts-data-table Props
- **155.** 575-line component — InlineEdit extracted
- **156.** No inline editing — InlineEdit on email + phone
- **157.** No keyboard shortcuts — arrow nav in DataTable
- **158.** Rate limiting — added to login/signup routes
- **159.** All previous UI/UX bugs (navigation, sidebar, bulk actions)
- **160.** All P0/P1 deployment blockers resolved
- **161.** Quick Wins (10/10): db:push removal, requestId, vitest exclusions, coverage thresholds, slow query logging, rate limiting middleware, prometheus metrics, loki+promtail, pgbouncer, worker health check

### Audit Session Fixes
- **162.** `logError()` now captures source location
- **163.** Stack traces and messages no longer truncated
- **164.** POST /api/superadmin/errors no longer returns `{ok: true}` on failure
- **165.** DB catch blocks now log failures
- **166.** Error page shows fetch failure state with retry
- **167.** Error page shows source/breadcrumb from context
- **168.** Copy buttons on stack trace and context JSON
- **169.** error.tsx boundary added for superadmin layout

---

## SUMMARY

| Category | Count |
|----------|-------|
| **Critical Security (OPEN)** | 6 |
| **High Priority (OPEN)** | 18 |
| **Medium Priority (OPEN)** | 32 |
| **Low Priority (OPEN)** | 8 |
| **E2E Test Failures** | 5 |
| **Remaining Features** | 54 |
| **Setup Issues (Historical)** | 8 |
| **Previously Fixed** | 27+ |
| **Total Tracked** | **~169 items** |

## OPEN PULL REQUESTS

| PR # | Title | Branch |
|------|-------|--------|
| 90 | fix: E2E test user seed script + vitest timeout | fix/e2e-test-user-setup |
| 89 | fix: Next.js 16 params await, logAudit signature, cache lock, type fixes | fix/nextjs16-params-audit-log |
| 88 | fix: OOM stability, Docker memory limits, RLS migration | fix/oom-startup-stability |
| 87 | fix: requireAuth() super admin context ignores tenant membership | fix/require-auth-superadmin |
| 86 | fix: resolve 4 failing unit tests (bcrypt timeout + industry-templates timeout) | fix/failing-integration-tests |
| 85 | fix: improve proxy.ts route matcher exclusions and deprecate ANTHROPIC_API_KEY | fix/proxy-route-exclusions |
| 84 | fix: replace hardcoded CI secrets with GitHub Actions secrets | fix/ci-secrets-environment |
| 83 | security: fix CSRF SameSite mismatch, JWT leak, ALLOWED_ORIGINS wildcard, auth CSRF exemption | fix/security-hotfix-2026-06-04 |
| 82 | feat: Assignment Rules UI | feat/assignment-rules-ui |
| 81 | feat: Call Logger UI | feat/call-logger-ui |
| 80 | feat: Saved Views UI | feat/saved-views-ui |
| 77 | feat: test infrastructure | phase/test-infrastructure-overhaul |
| 76 | feat: CI/CD pipeline | phase/deploy-pipeline |
| 75 | feat: cache stampede protection | phase/cache-stampede-protection |
| 74 | feat: runtime feature flags | phase/feature-flags-system |
| 73 | feat: Alertmanager | phase/observability-alerting |
| 72 | feat: Prometheus metrics | phase/observability-metrics-endpoint |
| 71 | fix: worker health check | quick/worker-health-check |
| 70 | feat: PgBouncer pooling | quick/pgbouncer-connection-pooling |
| 69 | feat: Loki + Promtail | quick/loki-promtail-log-shipping |
| 68 | fix: drizzle-schema tests | quick/fix-drizzle-schema-tests |
| 67 | feat: dashboard overhaul | feat/enterprise-infrastructure |
| 66 | feat: rate limit middleware | feat/rate-limit-middleware |
| 51 | fix: production build | fix/production-build-issues |
| 50 | fix: typecheck/lint/hooks | fix/production-build-typecheck-lint |
| 46 | security: vulnerabilities v2 | fix/security-vulnerabilities-v2 |
| 32 | feat: approval workflow | feat/phase-6-approval-surfaces |
| 30 | chore: proxy.ts migration | chore/middleware-to-proxy |
| 29 | feat: customer offers | feat/phase-4-offers |
| 26 | feat: workflow foundation | feat/workflow-foundation |
| 12 | feat: file attachments | feat/documents |
| 11 | feat: white-label branding | feat/branding |
| 8 | feat: OIDC foundation | feat/sso-foundation |
| 2 | feat: foundation proxy+gate | feat/foundation-proxy-and-gate |

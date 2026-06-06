# NuCRM Enterprise — Master Build Plan

**Last Updated:** 2026-06-06 (Session 2 — Part 5)
**This is the single source of truth.** Read before every session.

---

## THIS SESSION (Session 2 — 2026-06-06)

### Completed
- Created GitHub issues #91–#108 to track all remaining work
- Created GitHub issues #116–#121 for remaining Week 2 big items
- **Week 1 issues (1-7) fully resolved** via PRs #99, #100
- **Week 2 quick wins resolved** (PRs #109–#115):
  - #102: Added `.dockerignore` excluding secrets and build artifacts
  - #103: Removed unnecessary `db.transaction()` wrapper from `requireAuth()`
  - #104: Set `DATABASE_SSL=true` in production config
  - #105: Removed hardcoded `JWT_SECRET` default from Dockerfile
  - #106: Added CSP + HSTS security headers to `next.config.mjs`
  - #107: Replaced hardcoded Grafana admin password with placeholder
  - #108: Fixed V2 API Gateway CORS — deny by default, wildcard only in dev
- **Issue #8 (#116): API routes leak err.message** ✅ Resolved via PR #122
  - Replaced `err.message` with `apiError()` across 34 route files
  - Also fixed 5 merge conflict markers (18 TS errors)
- **Issue #9 (#117): TypeScript errors** ✅ Resolved via PR #123
  - Fixed 27 TS errors across 14 files
  - `npm run typecheck` now passes with 0 errors
- **Issues #14-15 (#118): Silent catch blocks** ✅ Resolved via PR #124
  - Replaced 64 `.catch(() => {})` + 8 empty `catch {}` with logged errors across 40 files
- All PRs tested (920 unit tests pass at each step), merged, pushed, branches cleaned.
- Deleted 14 stale merged branches.

### Remaining Week 2 (Big Items)
- Issue #16 (#119): `useEffect` without cleanup in 40+ components (~2hr)
- Issue #17 (#120): Missing Zod validation on remaining routes (~3hr)
- Issue #19 (#121): 200+ `as any` type assertions (~4hr)
- Issues #14-15: `.catch(()=>{})` and empty `catch {}` blocks (~4hr combined)
- Issue #16: `useEffect` without cleanup in 40+ components (~2hr)
- Issue #17: Missing Zod validation on remaining routes (~3hr)
- Issue #19: 200+ `as any` type assertions (~4hr)

### Phase A (Follow-Up Intelligence) — Not Started
Core vision: DB table → CRUD API → cron → widget → missed badge → page

---

## SECTION 1: PRODUCT VISION

A CRM where **no lead falls through the cracks**. The system actively ensures every follow-up happens on time, and if the user misses — AI steps in.

### 8 Pillars
1. **Leads & Pipelines** — Very fine pipelines, idle/pending lead states, explicit claim
2. **Follow-Up Intelligence** — "Follow up today" visibility, missed date badges, auto-scheduling
3. **AI Auto-Follow-Up (Opt-In)** — AI takes over on missed follow-up if enabled
4. **Smart Lead Scoring** — Configurable rules, hot/warm/cold, real-time score updates
5. **Multi-Channel Outreach** — Email, SMS, WhatsApp unified per-contact inbox
6. **Deliverability Engine** — Warmup, spam check, bounce handling, domain reputation
7. **Automated Workflows** — No-code builder, triggers, conditions, actions
8. **Real-Time Analytics** — Live dashboards, follow-up stats, per-user performance

---

## SECTION 2: BUILD PROGRESS (FE / BE / UIUX)

### PILLAR 1: Lead Management & Pipelines — **85%**

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ CRUD, assign, convert, import, bulk, history | ❌ No lead state machine (idle→active) |
| **Frontend** | ✅ Kanban, list, detail, pipeline settings | ❌ No idle/active state indicator |
| **UI/UX** | ✅ Kanban drag & drop, view toggle | ❌ Pipeline drag-reorder in settings |

### PILLAR 2: Follow-Up Intelligence — **70%** 🔴 CORE GAP

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Tasks with due dates, reminders cron, overdue detection | ❌ No dedicated follow-up entity, no "missed by X days" |
| **Frontend** | ✅ Task list, calendar, overdue filter | ❌ No "Follow up today" widget, no "Missed Follow-ups" page |
| **UI/UX** | ✅ Overdue badges | ❌ No "⚠ You missed by N days" badge |

### PILLAR 3: AI Auto-Follow-Up — **80%**

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Multi-provider gateway, drafts, templates, activity log | ❌ No autonomous cron, no opt-in toggle |
| **Frontend** | ✅ AI Hub, draft page, activity log, provider settings | ❌ No AI auto-follow-up settings section |
| **UI/UX** | ✅ Manual "Draft a follow-up" | ❌ No opt-in toggle, no "AI sent follow-up" indicator |

### PILLAR 4: Smart Lead Scoring — **75%**

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Rules table, scores table, AI engine, batch cron | ❌ Rules condition field is free-text (not executed) |
| **Frontend** | ✅ Rules settings, scoring results page | ❌ No hot/warm/cold badges in list views |
| **UI/UX** | ✅ Score tier helper exists in code | ❌ Badges not shown, no score history chart |

### PILLAR 5: Multi-Channel Outreach — **80%**

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Email sequences, tracking, SMS, WhatsApp, call logs | ❌ No unified inbox per contact |
| **Frontend** | ✅ Sequences page, SMS page, WhatsApp chat, call logger | ❌ No combined channel timeline |
| **UI/UX** | ✅ Sequence builder, WhatsApp widget, call logger | ❌ Messages scattered across separate pages |

### PILLAR 6: Deliverability Engine — **30%** 🔴 BIGGEST GAP

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Warmup configs, pool, logs, cron, engine | ❌ No spam check, no bounce classification, no domain reputation |
| **Frontend** | ✅ Basic email settings | ❌ No deliverability dashboard |
| **UI/UX** | — | ❌ No spam score, no domain health |

### PILLAR 7: Automated Workflows — **85%**

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Workflows engine, executions, logs, templates, webhooks | ❌ No versioning, no rollback |
| **Frontend** | ✅ Visual drag-drop builder (React Flow, 11 node types) | ❌ No workflow marketplace |
| **UI/UX** | ✅ 11 node types, prebuilt templates | ❌ Condition node UI untested |

### PILLAR 8: Real-Time Analytics — **75%**

| Layer | Status | What's Missing |
|-------|--------|----------------|
| **Backend** | ✅ Dashboard data, 12+ widgets, analytics, reports, leaderboard | ❌ No WebSocket real-time |
| **Frontend** | ✅ Dashboard, analytics pages, report builder, leaderboards | ❌ No per-user performance view |
| **UI/UX** | ✅ 12 widgets, configurable grid | ❌ No drill-down, no real-time refresh |

### OVERALL: **72%** complete

---

## SECTION 3: ALL OPEN ISSUES — SORTED BY FIX ORDER

### ✅ WEEK 1 COMPLETE (Issues 1-7)

All Week 1 critical security issues are resolved:

| # | Issue | Status | PR |
|---|-------|--------|----|
| 1 | `branch fix/runtime-errors-ui-v2` unmerged | ✅ Already squash-merged (PR #79) | #79 |
| 2 | `.env.local` tracked by git | ✅ Already in `.gitignore`, not tracked | — |
| 3 | JWT token leaked in login response | ✅ Fixed via security hotfix | #83 |
| 4 | CSRF exemption for ALL `/api/auth/` routes | ✅ Fixed via security hotfix | #83 |
| 5 | CSRF "hash" is fake `String.hashCode()` | ✅ Replaced with `crypto.createHash('sha256')` | #99 |
| 6 | No rate limit on `/api/auth/csrf-token` | ✅ Added 5 req/min limit | #100 |
| 7 | `require()` used in ESM modules | ✅ Replaced with top-level ESM `import crypto` | #99 |

### 🟡 WEEK 2 — High Priority Fixes (Remaining)

| # | Issue | File(s) | How to Fix | Est. | Status |
|---|-------|---------|------------|------|--------|
| 8 | 50+ API routes leak `err.message` | ~50 route files | Wrap in `apiError()` — centralize in `lib/api-error.ts` | 1hr | ❌ Open |
| 9 | `ignoreBuildErrors: true` | `next.config.mjs:15` | Already CI-only. Fix the 63 TS errors it was hiding | 2hr | ❌ Open |
| 14 | 103+ `.catch(() => {})` silent swallows | Codebase-wide | Replace with `.catch(err => logError(err, '[context]'))` | 2hr | ❌ Open |
| 15 | 190+ empty `catch {}` blocks | Codebase-wide | Same — add error logging | 2hr | ❌ Open |
| 16 | `useEffect` without cleanup (40+ components) | Codebase-wide | Add return cleanup functions, AbortController for fetch | 2hr | ❌ Open |
| 17 | Most API routes skip Zod validation | ~70% of route files | Add Zod schemas + `validateBody()` to remaining routes | 3hr | ❌ Open |
| 19 | 200+ `as any` type assertions | Codebase-wide | Replace with proper types or `as unknown as T` with TODO | 4hr | ❌ Open |

### ✅ WEEK 2 COMPLETE (Quick Wins)

| # | Issue | PR | Status |
|---|-------|----|--------|
| 10 | No `.dockerignore` | #109 | ✅ Merged |
| 11 | `DATABASE_SSL=false` in production | #111 | ✅ Merged |
| 12 | Dockerfile hardcodes `JWT_SECRET` | #112 | ✅ Merged |
| 13 | V2 API Gateway wildcard CORS | #115 | ✅ Merged |
| 18 | `requireAuth()` wrapped in DB transaction | #110 | ✅ Merged |
| 20 | Missing CSP + HSTS headers | #113 | ✅ Merged |
| 21 | Grafana admin password "admin" | #114 | ✅ Merged |

### 🟠 WEEK 3 — Medium Priority

| # | Issue | File(s) | How to Fix | Est. |
|---|-------|---------|------------|------|
| 22 | SQL injection in custom-fields | `app/api/tenant/custom-fields/route.ts` | Use parameterized queries, whitelist table names | 30min |
| 23 | No error.tsx on superadmin pages | `/app/superadmin/*` pages | Add `error.tsx` boundary to each route group | 30min |
| 24 | Custom TOTP has edge cases | `lib/auth/api-handlers.ts:83-89` | Replace with `otplib` library | 20min |
| 25 | Proxy-based DB singleton loses type safety | `drizzle/db.ts:15-19` | Remove `as unknown` cast, use proper typing | 10min |
| 26 | GDPR N+1 query (8 sequential) | `lib/compliance/gdpr.ts:56-135` | Use `Promise.all()` for parallel queries | 15min |
| 27 | SOC2 N+1 query | `lib/compliance/soc2.ts:122-328` | Same pattern fix | 15min |
| 28 | `requestToJson()` swallows parse errors | `app/api/forms/submit/route.ts:200-206` | Return error response on invalid JSON | 10min |
| 29 | Multiple `.json().catch(() => ({}))` | Various routes | Return proper 400 on invalid JSON | 20min |
| 30 | `verifySecret()` timing leak | `lib/crypto.ts:17-19` | Use constant-time comparison always (no early return) | 10min |
| 31 | BigInt serialization in metrics | `app/api/metrics/route.ts:101` | Cast to `Number()` or use `Number(count)` | 5min |
| 32 | `dangerouslySetInnerHTML` in 5 components | Check each | Use DOMPurify or proper React rendering | 20min |
| 33 | Mixed ESM/CJS module patterns | Various files | Standardize on ESM `import` everywhere | 30min |
| 34 | No log rotation for file logger | `lib/logger.ts` | Add logrotate config or date-based rotation | 15min |
| 35 | Grafana Loki errors silently dropped | `lib/grafana.ts:320` | Add proper error handling + alerting | 10min |
| 36 | No real-time alerting for errors | — | Add Slack/PagerDuty webhook for critical errors | 30min |
| 37 | API error + logError don't coordinate | `lib/api-error.ts`, `lib/errors.ts` | Make `apiError()` also call `logError()` | 10min |
| 38 | POST /superadmin/errors returns 500 details | `app/api/superadmin/errors/route.ts:112` | Strip `details` field in production | 10min |
| 39 | Cron jobs skip CSRF | `lib/auth/csrf.ts:144` | Already by design (header secret) — document it | 5min |
| 40 | Server hung/unresponsive | — | Add health check endpoint + keepalive | 30min |
| 41 | Slow filesystem warning | `.next/dev` location | Move .next to faster drive or tmpfs | 10min |
| 42 | Notification system errors (RLS/FK) | Investigate | Check RLS policies on `notifications` table | 30min |
| 43 | Database sync error (`db:push` fails) | Schema registry | Fix circular dependency in `drizzle/schema/_registry.ts` | 1hr |
| 44 | AI Sentiment not populated | Email processor | Add sentiment analysis to email processing pipeline | 30min |
| 45 | Missing Server Action | Stale client code | Rebuild client: `npm run build` | 10min |
| 46 | Notifications API fails every 60s | Polling loop | Fix the polling error in notification component | 20min |
| 47 | No OpenAPI/Swagger docs | — | Generate from Zod schemas | 2hr |
| 48 | DATABASE_SSL=false in Docker | `docker-compose.yml` | Already captured in #11 | — |

### 🟢 WEEK 4 — Low Priority & Polish

| # | Issue | How to Fix | Est. |
|---|-------|------------|------|
| 49 | No i18n / internationalization | Add next-i18next | 4hr |
| 50 | `FILTER(Boolean) as string[]` assertion | Proper type guard | 10min |
| 51 | Duplicate `jsdom` override | Clean up package.json | 5min |
| 52 | Package name mismatch (`nucrm-saas` vs `nucrm-enterprise`) | Rename in package.json | 5min |
| 53 | Unused `ANALYZE=true` bundle config | Remove dead config | 10min |
| 54 | Unused `STRIPE_PRICE_ID` placeholders | Remove or document | 5min |
| 55 | Merge conflict markers in git history | Clean up | 10min |
| 56 | No branch protection on main | GitHub repo settings | 5min |

### 🧪 E2E TESTS

| # | Issue | How to Fix | Est. |
|---|-------|------------|------|
| 57 | 5 E2E tests fail (missing seed data) | Extend `scripts/seed-e2e-user.ts` — add pipeline + 6 stages + 5-10 contacts + 3-5 deals | 30min |

---

## SECTION 4: FEATURE ROADMAP (VISION PILLARS)

### Phase A — Follow-Up Intelligence (Week 1-2) ⭐ CORE VISION

| Step | What to Build | Files to Create/Edit |
|------|--------------|----------------------|
| A1 | Add `followUps` DB table (leadId, dueDate, status, missedDays, autoAiEnabled) | `drizzle/schema/crm.ts` (new table) |
| A2 | API: CRUD follow-ups + auto-schedule + missed detection cron | `app/api/tenant/follow-ups/route.ts`, `app/api/tenant/follow-ups/[id]/route.ts`, `app/api/cron/detect-missed-followups/route.ts` |
| A3 | "Follow up today" dashboard widget | `components/tenant/dashboard/widgets/followups-widget.tsx` |
| A4 | "⚠ You missed follow-up by N days" badge on leads/contacts | Badge component + integrate into lead/contact detail |
| A5 | "Missed Follow-ups" page | `app/tenant/follow-ups/missed/page.tsx` |
| A6 | Auto-schedule follow-up when lead goes idle (no activity for N days) | Integration with lead activity table |

### Phase B — AI Auto-Follow-Up (Week 2)

| Step | What to Build | Files to Create/Edit |
|------|--------------|----------------------|
| B1 | Opt-in toggle: "Enable AI auto-follow-up" in tenant settings | `app/tenant/settings/ai-auto-followup/page.tsx` |
| B2 | AI cron: when follow-up is missed +24h and AI enabled → auto-send | `app/api/cron/ai-auto-followup/route.ts` |
| B3 | "AI sent a follow-up on your behalf" notification | Use existing notification system |
| B4 | Review/cancel AI-scheduled follow-ups page | `app/tenant/ai/scheduled/page.tsx` |

### Phase C — Smart Lead Scoring UI (Week 2-3)

| Step | What to Build | Files to Create/Edit |
|------|--------------|----------------------|
| C1 | Hot/Warm/Cold badges on lead list & detail | Badge component + integrate into `leads-client.tsx`, `lead-detail-client.tsx` |
| C2 | Score factor breakdown panel | `components/tenant/scoring-breakdown.tsx` |
| C3 | Score history chart | Recharts integration in lead detail |
| C4 | Execute scoring rules `condition` field | `lib/ai/lead-scoring.ts` — parse and evaluate conditions |

### Phase D — Deliverability Engine (Week 3-4)

| Step | What to Build | Files to Create/Edit |
|------|--------------|----------------------|
| D1 | Spam score check (integration with SpamAssassin/Mailgun) | `lib/email/spam-check.ts` |
| D2 | Bounce classification (hard vs soft) + automated handling | `lib/email/bounce-handler.ts` |
| D3 | Domain reputation monitoring | `lib/email/domain-reputation.ts` |
| D4 | Deliverability dashboard | `app/tenant/analytics/deliverability/page.tsx` |
| D5 | Send-time optimization (when does lead open?) | `lib/email/send-optimizer.ts` |

### Phase E — Multi-Channel Unified Inbox (Week 4)

| Step | What to Build | Files to Create/Edit |
|------|--------------|----------------------|
| E1 | Per-contact unified inbox combining email, SMS, WhatsApp | `components/tenant/unified-inbox.tsx` |
| E2 | Cross-channel sequence builder (email→SMS→WhatsApp) | Extend `sequence-builder.tsx` |

### Phase F — Analytics & Polish (Week 4+)

| Step | What to Build |
|------|--------------|
| F1 | WebSocket real-time dashboard updates |
| F2 | Per-user follow-up performance stats |
| F3 | Dashboard drill-down (click widget → detail) |
| F4 | Report export to PDF |

---

## SECTION 5: PARALLEL BRANCH TRACKER

| Branch | Status | Merged? |
|--------|--------|---------|
| `feat/foundation-proxy-and-gate` | ✅ Done | ✅ Yes |
| `feat/sso-foundation` | ✅ Done | ✅ Yes |
| `feat/branding` | ✅ Done | ✅ Yes |
| `feat/documents` | ✅ Done | ✅ Yes |
| `feat/workflow-foundation` | ✅ Done | ✅ Yes |
| `feat/phase-4-offers` | ✅ Done | ✅ Yes |
| `feat/phase-6-approval-surfaces` | ✅ Done | ✅ Yes |
| `fix/security-vulnerabilities-v2` | ✅ Done | ✅ Yes |
| `chore/middleware-to-proxy` | ✅ Done | ✅ Yes |
| `feat/rate-limit-middleware` | ✅ Done | ✅ Yes |
| `fix/runtime-errors-ui-v2` | ✅ Squash-merged via #79 | ✅ Yes — deleted |
| `quick/remove-db-push` | ✅ Squash-merged via #54 | ✅ Yes — deleted |
| `quick/add-request-id` | ✅ Squash-merged via #56 | ✅ Yes — deleted |
| `quick/fix-vitest-config` | ✅ Squash-merged via #58 | ✅ Yes — deleted |
| `quick/slow-query-logging` | ✅ Squash-merged via #60 | ✅ Yes — deleted |
| `feat/ci-cd-pipeline` | ✅ Squash-merged via #64 | ✅ Yes — deleted |
| `feat/prometheus-metrics` | ✅ Squash-merged via #62 | ✅ Yes — deleted |
| `fix/csrf-hash-webcrypto-91` | ✅ Merged | ✅ Yes — #99 |
| `fix/rate-limit-csrf-token-92` | ✅ Merged | ✅ Yes — #100 |
| `fix/branding-compat-exports` | ✅ Merged | ✅ Yes — #101 |

### Fragile Interfaces (change with caution)
| File | Why Fragile |
|------|-------------|
| `lib/branding.ts` | Multiple consumers: BrandingProvider, tenant layout |
| `proxy.ts` | Auth, CSRF, rate limiting, CORS |
| `lib/auth/api-handlers.ts` | Login, signup — core auth |
| `drizzle/schema/*.ts` | All features share schema registry |
| `app/tenant/layout.tsx` | Wraps all tenant pages |
| `lib/auth/csrf.ts` | All API routes depend on this |

---

## SECTION 6: SAFETY CHECKS PROTOCOL

### Every Session Start
```bash
# 1. Read this file (BUILD_PLAN.md)
# 2. Check server is running
curl -s http://localhost:3000/
# 3. Check for unmerged work
git log --oneline --not --remotes --branches
```

### Before Any Commit
```bash
npm run lint           # No new warnings
npm run test:unit      # All 920+ tests pass
```

### Before Merge to Main
```bash
npm run premerge       # Runs: tsc + build + tests + import check
```

### After Every Merge
```bash
npm run smoke          # Server health + login + pages
```

### Available Commands
| Command | What It Does |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run typecheck` | TypeScript check (0 errors) |
| `npm run check` | typecheck + lint + tests |
| `npm run premerge` | Full pre-merge safety check |
| `npm run smoke` | Smoke test (server + login + pages) |
| `npm run test:unit` | Unit tests |
| `npm run build` | Production build |

---

## SECTION 7: OPEN PULL REQUESTS (from GitHub)

| PR | Title | Branch | Should We Merge? |
|----|-------|--------|-------------------|
| 101 | fix: TenantBranding exports + allowedDevOrigins | `fix/branding-compat-exports` | ✅ Merged |
| 100 | fix: Rate limit on csrf-token endpoint | `fix/rate-limit-csrf-token-92` | ✅ Merged |
| 99 | fix: CSRF hash → crypto.createHash('sha256') | `fix/csrf-hash-webcrypto-91` | ✅ Merged |
| 98 | feat: Prometheus metrics endpoint | `feat/prometheus-metrics` | ✅ Already merged (PR #62) |
| 97 | feat: CI/CD pipeline | `feat/ci-cd-pipeline` | ✅ Already merged (PR #64) |
| 96 | perf: slow query threshold | `quick/slow-query-logging` | ✅ Already merged (PR #60) |
| 95 | fix: disable db:push | `quick/remove-db-push` | ✅ Already merged (PR #54) |
| 94 | fix: vitest coverage thresholds | `quick/fix-vitest-config` | ✅ Already merged (PR #58) |
| 93 | feat: requestId for distributed tracing | `quick/add-request-id` | ✅ Already merged (PR #56) |
| 92 | fix: rate limit on csrf-token | `fix/rate-limit-csrf-token-92` | ✅ Merged |
| 91 | fix: CSRF hash → Web Crypto API | `fix/csrf-hash-webcrypto-91` | ✅ Merged |

---

## SECTION 8: RECOMMENDED BUILD ORDER

```
WEEK 1                    WEEK 2                    WEEK 3                    WEEK 4
─────────────────         ─────────────────         ─────────────────         ─────────────────
🔴 Fix critical sec      🟡 Fix high issues        🟠 Fix medium issues      🟢 Low priority
   (issues 1-6)              (issues 7-21)              (issues 22-48)            (issues 49-56)
         │                        │                           │
         ▼                        ▼                           ▼
── Phase A starts ──►   Phase B starts              Phase C starts            Phase D starts
Follow-Up Intelligence   AI Auto-Follow-Up           Smart Lead Scoring UI     Deliverability Engine
   A1: DB table            B1: Opt-in toggle          C1: Badges in lists       D1: Spam check
   A2: CRUD API + cron     B2: AI auto-send cron      C2: Score breakdown       D2: Bounce handling
   A3: Dashboard widget    B3: Notifications           C3: History chart         D3: Domain reputation
   A4: Missed badge        B4: Review page             C4: Execute conditions    D4: Dashboard
   A5: Missed page                                                  │
   A6: Auto-schedule                                                 ▼
                                                           Phase E starts
                                                           Unified Inbox
                                                                  │
                                                                  ▼
                                                           Phase F starts
                                                           Analytics polish
```

**Quick summary:** Fix security first → Build follow-up system (core vision) → Add AI → Polish scoring → Fix deliverability → Unify inbox → Analytics

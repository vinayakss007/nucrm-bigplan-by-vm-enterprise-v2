# NuCRM Enterprise — Master Tracker

**Last Updated:** 2026-06-06
**Read before any work begins.** Update when creating/merging branches.

---

## 1. PARALLEL FEATURE BRANCHES

| Branch | Status | Dependencies | Merged to Main? |
|--------|--------|-------------|----------------|
| `feat/foundation-proxy-and-gate` | ✅ Done | — | ✅ Yes |
| `feat/sso-foundation` | ✅ Done | — | ✅ Yes |
| `feat/branding` | ✅ Done | `lib/branding.ts` exports | ✅ Yes |
| `feat/documents` | ✅ Done | — | ✅ Yes |
| `feat/workflow-foundation` | ✅ Done | — | ✅ Yes |
| `feat/phase-4-offers` | ✅ Done | — | ✅ Yes |
| `feat/phase-6-approval-surfaces` | ✅ Done | — | ✅ Yes |
| `fix/security-vulnerabilities-v2` | ✅ Done | — | ✅ Yes |
| `chore/middleware-to-proxy` | ✅ Done | — | ✅ Yes |
| `feat/rate-limit-middleware` | ✅ Done | `proxy.ts` | ✅ Yes |
| `fix/runtime-errors-ui-v2` | 🔴 **Unmerged** (4 commits) | — | ❌ No |

### Unmerged: `fix/runtime-errors-ui-v2`
- `2ef9ab8` — fix invalid Swipeable wrapping `<tr>` elements
- `9442faa` — fix hydration mismatch in theme toggle button
- `37d1e42` — fix company detail stats query / result extraction
- `6c6972d` — add allowed dev origin, simplify PWA manifest icons

---

## 2. FEATURE PROGRESS TOWARD VISION

| Vision Pillar | Status | What Exists | What's Missing |
|--------------|--------|------------|----------------|
| **Fine pipelines** | ⚠️ Partial | Deal stages, pipelines table, Kanban | Lead-specific pipelines with idle/pending states |
| **Follow-up intelligence** | ❌ Missing | Tasks exist | No "missed follow-up" badge, no "follow up today" view, no overdue tracking |
| **AI auto-follow-up** | ❌ Missing | AI gateway foundation | No AI follow-up engine, no opt-in toggle, no AI email drafting for missed follow-ups |
| **Smart lead scoring** | ⚠️ Partial | Contact scoring (hot/warm/cold) | No configurable rules, no real-time score updates, no weight system |
| **Multi-channel outreach** | ⚠️ Partial | Email sequences, SMS/Twilio, WhatsApp foundation | No unified inbox per lead, no multi-channel sequence builder |
| **Deliverability engine** | ❌ Missing | Email sending works | No warmup, spam check, bounce analytics, send-time optimization |
| **Automated workflows** | ⚠️ Partial | Workflow foundation merged | No no-code builder UI, no trigger/condition/action system |
| **Real-time analytics** | ⚠️ Partial | Dashboard exists | No follow-up stats, missed-follow-up reports, per-user performance, leaderboards |
| **Idle lead state** | ❌ Missing | — | Leads should stay idle until explicitly claimed |

---

## 3. OPEN PULL REQUESTS (from GitHub)

| PR | Title | Branch | Notes |
|----|-------|--------|-------|
| 90 | fix: E2E test user seed + vitest timeout | fix/e2e-test-user-setup | Tests only |
| 89 | fix: Next.js 16 params await, logAudit, cache lock | fix/nextjs16-params-audit-log | |
| 88 | fix: OOM stability, Docker memory limits | fix/oom-startup-stability | |
| 87 | fix: requireAuth() super admin context | fix/require-auth-superadmin | |
| 86 | fix: 4 failing unit tests | fix/failing-integration-tests | |
| 85 | fix: proxy.ts route exclusions | fix/proxy-route-exclusions | |
| 84 | fix: CI secrets → GitHub Actions | fix/ci-secrets-environment | |
| 83 | security: CSRF, JWT, ALLOWED_ORIGINS fix | fix/security-hotfix-2026-06-04 | |
| 82 | feat: Assignment Rules UI | feat/assignment-rules-ui | |
| 81 | feat: Call Logger UI | feat/call-logger-ui | |
| 80 | feat: Saved Views UI | feat/saved-views-ui | |
| 68 | fix: drizzle-schema tests | quick/fix-drizzle-schema-tests | |

---

## 4. KNOWN FRAGILE INTERFACES (things that break when touched)

These are the files/areas that **multiple features depend on** — changing them risks breaking other things:

| File | Used By | Danger Level |
|------|---------|-------------|
| `lib/branding.ts` | Branding feature, tenant layout, BrandingProvider | 🔴 High |
| `proxy.ts` | Auth, rate limiting, CSRF, public paths | 🔴 High |
| `lib/auth/api-handlers.ts` | Login, signup, auth flow | 🔴 High |
| `drizzle/schema/*.ts` | All features share the schema registry | 🔴 High |
| `app/tenant/layout.tsx` | All tenant pages | 🟡 Medium |
| `lib/auth/csrf.ts` | CSRF protection across all API routes | 🟡 Medium |
| `lib/auth/session.ts` | Session/JWT management | 🟡 Medium |

---

## 5. PRE-MERGE CHECKLIST (MUST FOLLOW)

Before merging ANY branch into main, run:
```bash
# 1. TypeScript check
npx tsc --noEmit --pretty 2>&1 | grep -v "node_modules" | grep "error TS"

# 2. Build test
npm run build 2>&1 | tail -5

# 3. Unit tests
npm run test:unit 2>&1 | tail -5

# 4. Check new imports exist in target
git diff main...HEAD -- '*.ts' '*.tsx' | grep "^\+import" | grep "from '@/"

# 5. Smoke test (server starts)
scripts/smoke-test.sh
```

---

## 6. BRANCH CREATION RULES

When creating a new feature branch:
1. Branch from `main`
2. Name: `feat/<short-description>`
3. Add entry to PARALLEL FEATURE BRANCHES table above
4. List any dependencies on other branches
5. After merge → mark as ✅ Yes in Merged column

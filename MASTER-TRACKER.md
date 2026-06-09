# NuCRM Enterprise — Master Tracker

**Rule:** Every fix/feature gets a GitHub issue → a branch → a PR → merge to main.
**No direct commits to main.** Everything trackable.

---

## How This Works

1. Each row has a GitHub issue number
2. Work happens on a branch named `fix/<slug>` or `feat/<slug>`
3. When done, push branch → create PR → PR is reviewed → merge to main via PR
4. After merge, delete branch

---

## PHASE A — Follow-Up Intelligence ✅ COMPLETE

| Step | Issue | Branch | Status |
|------|-------|--------|--------|
| A1-A6 | #152 | `feat/follow-up-intelligence` | ✅ Done |

---

## PHASE B — AI Auto-Follow-Up

| Step | Issue | Branch | Status |
|------|-------|--------|--------|
| B1: Opt-in toggle in tenant AI settings | #154 | `feat/ai-auto-followup` | 🔴 Not started |
| B2: AI auto-send cron for missed follow-ups | #154 | same branch | 🔴 Not started |
| B3: AI notification "AI sent on your behalf" | #154 | same branch | 🔴 Not started |
| B4: Review/cancel AI-scheduled page | #154 | same branch | 🔴 Not started |

---

## CRITICAL SECURITY (Week 2 Holdovers)

| # | Issue | Branch | Est. | Status |
|---|-------|--------|------|--------|
| 155 | 6 critical security issues still OPEN | `fix/critical-security-issues` | 3hr | 🔴 Not started |
| 129 | SECURITY: .env.local tracked in git — secrets | `fix/env-local-secrets` | 30min | 🔴 Not started |
| 143 | SQL injection via dynamic table names (custom-fields) | `fix/sql-injection-custom-fields` | 30min | 🔴 Not started |

---

## HIGH PRIORITY FIXES

| # | Issue | Branch | Est. | Status |
|---|-------|--------|------|--------|
| 157/121 | 200+ `as any` type assertions | `fix/as-any-assertions` | 4hr | 🔴 Not started |
| 147 | 3067 ESLint warnings → below 100 | `fix/eslint-warnings` | 4hr | 🔴 Not started |
| 158 | Notification system, hydration, pg bundle, dashboard | `fix/notification-system` | 3hr | 🔴 Not started |
| 134 | useEffect without cleanup in 40+ components | `fix/useeffect-cleanup` | 2hr | 🔴 Not started |
| 133 | 103+ .catch(() => {}) + 190+ empty catch {} | `fix/silent-catch-blocks` | 2hr | 🔴 Not started |
| 148 | Missing FK references on tenantId/createdBy | `fix/missing-fk-references` | 1hr | 🔴 Not started |
| 141 | 5/24 E2E tests failing (missing seed data) | `fix/e2e-seed-data` | 30min | 🔴 Not started |
| 149 | Automated daily DB backups with 30-day retention | `ops/daily-db-backups` | 1hr | 🔴 Not started |

---

## MEDIUM PRIORITY (Week 3 — BUILD_PLAN Issues 22-48)

| BUILD_PLAN # | GitHub # | Title | Branch | Est. | Status |
|--------------|----------|-------|--------|------|--------|
| 22 | #143 | SQL injection in custom-fields route | `fix/sql-injection-custom-fields` | 30min | 🔴 Not started |
| 23 | #160 | No error.tsx on superadmin pages | `fix/superadmin-error-boundaries` | 30min | 🔴 Not started |
| 24 | #161 | Custom TOTP edge cases | `fix/totp-edge-cases` | 20min | 🔴 Not started |
| 25 | #162 | Proxy-based DB singleton loses type safety | `fix/db-singleton-type-safety` | 10min | 🔴 Not started |
| 26 | #163 | GDPR N+1 query (8 sequential) | `fix/gdpr-n-plus-one` | 15min | 🔴 Not started |
| 27 | #164 | SOC2 N+1 query | `fix/soc2-n-plus-one` | 15min | 🔴 Not started |
| 28 | #165 | requestToJson() swallows parse errors | `fix/request-to-json-errors` | 10min | 🔴 Not started |
| 29 | #166 | Multiple .json().catch(() => ({})) | `fix/json-parse-error-handling` | 20min | 🔴 Not started |
| 30 | #167 | verifySecret() timing leak | `fix/timing-leak-verify-secret` | 10min | 🔴 Not started |
| 31 | #168 | BigInt serialization in metrics | `fix/bigint-serialization` | 5min | 🔴 Not started |
| 32 | #169 | dangerouslySetInnerHTML in 5 components | `fix/dangerous-html-sanitize` | 20min | 🔴 Not started |
| 33 | #170 | Mixed ESM/CJS module patterns | `fix/esm-cjs-consistency` | 30min | 🔴 Not started |
| 34 | #171 | No log rotation for file logger | `fix/log-rotation` | 15min | 🔴 Not started |
| 35 | #172 | Grafana Loki errors silently dropped | `fix/loki-error-handling` | 10min | 🔴 Not started |
| 36 | #173 | No real-time alerting for errors | `feat/error-alerting-webhook` | 30min | 🔴 Not started |
| 37 | #174 | API error + logError don't coordinate | `fix/api-error-log-error` | 10min | 🔴 Not started |
| 38 | #175 | POST /superadmin/errors returns 500 details | `fix/superadmin-errors-strip-details` | 10min | 🔴 Not started |
| 39 | — | Cron jobs skip CSRF — document it | `docs/cron-csrf-documentation` | 5min | 🔴 Not started |
| 40 | #176 | Server hung/unresponsive — health check | `feat/health-check-endpoint` | 30min | 🔴 Not started |
| 41 | #177 | Slow filesystem warning (.next/dev) | `fix/next-dev-filesystem` | 10min | 🔴 Not started |
| 42 | #178 | Notification system errors (RLS/FK) | `fix/notification-rls-errors` | 30min | 🔴 Not started |
| 43 | #179 | Database sync error (db:push fails) | `fix/db-sync-circular-dependency` | 1hr | 🔴 Not started |
| 44 | #180 | AI Sentiment not populated | `fix/ai-sentiment-population` | 30min | 🔴 Not started |
| 45 | #181 | Missing Server Action | `fix/missing-server-action` | 10min | 🔴 Not started |
| 46 | #182 | Notifications API fails every 60s | `fix/notification-polling-error` | 20min | 🔴 Not started |
| 47 | #183 | No OpenAPI/Swagger docs | `feat/openapi-swagger-docs` | 2hr | 🔴 Not started |

---

## LOW PRIORITY (Week 4 — BUILD_PLAN Issues 49-56)

| BUILD_PLAN # | GitHub # | Title | Branch | Est. | Status |
|--------------|----------|-------|--------|------|--------|
| 49 | #184 | No i18n / internationalization | `feat/i18n-support` | 4hr | 🔴 Not started |
| 50 | #185 | FILTER(Boolean) as string[] assertion | `fix/filter-boolean-type` | 10min | 🔴 Not started |
| 51 | — | Duplicate jsdom override | `fix/duplicate-jsdom` | 5min | 🔴 Not started |
| 52 | — | Package name mismatch (nucrm-saas vs nucrm-enterprise) | `fix/package-name` | 5min | 🔴 Not started |
| 53 | — | Unused ANALYZE=true bundle config | `fix/unused-analyze-config` | 10min | 🔴 Not started |
| 54 | — | Unused STRIPE_PRICE_ID placeholders | `fix/unused-stripe-placeholders` | 5min | 🔴 Not started |
| 55 | — | Merge conflict markers in git history | `fix/merge-conflict-markers` | 10min | 🔴 Not started |
| 56 | — | Branch protection on main | `ops/branch-protection` | 5min | 🔴 Not started |

---

## TEST COVERAGE (Target: 100% lib/)

| Step | Issue | Branch | Status |
|------|-------|--------|--------|
| Track current coverage & raise thresholds | #151 | `test/coverage-lib` | 🔴 Not started |
| Add coverage for follow-ups feature | #153 | `test/coverage-follow-ups` | 🔴 Not started |
| Add missing tests for lib/ modules | #151 | `test/coverage-lib` | 🔴 Not started |
| Raise vitest thresholds to 100% | — | `test/coverage-lib` | 🔴 Not started |

---

## PHASE D — Deliverability Engine

| Step | Issue | Branch | Status |
|------|-------|--------|--------|
| D1-D5 | #156 | `feat/deliverability-engine` | 🔴 Not started |

---

## WORKFLOW

```bash
# Start a new fix:
git checkout main && git pull && git checkout -b fix/<slug>

# Do work, commit often:
git add -A && git commit -m "fix: description (#ISSUE)"

# Push & create PR:
git push -u origin fix/<slug>
gh pr create --title "fix: description" --body "Closes #ISSUE" --base main

# After PR merges, delete branch:
git checkout main && git pull && git branch -D fix/<slug>
```

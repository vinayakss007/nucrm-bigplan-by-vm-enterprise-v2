# NuCRM Enterprise — Master Tracker

**Last Updated:** 2026-06-09 (Session 4)
**Rule:** Every fix/feature gets a GitHub issue → a branch → a PR → merge to main.
**No direct commits to main.** Everything trackable.

---

## SESSION 4 PROGRESS (2026-06-09)

### Merged to main

| PR | Issue | Title | Branch |
|----|-------|-------|--------|
| — | — | 7 new unit tests: critical-data-capture, errors-server, field-encryption, history, offers, rate-limit-simple, sanitize (58 tests) | `test/coverage-batch-2` ✅ |
| #192 | #151 | 39 new tests for retry/scoring/keepalive/metrics — raise thresholds (lines 25→40, funcs 35→45, branches 30→35, stmts 25→40) | `test/coverage-increase-lib` ✅ |

## SESSION 3 PROGRESS (2026-06-09)

### New PRs Created (Awaiting Review & Merge)

| PR | Issue | Title | Branch | Status |
|----|-------|-------|--------|--------|
| #186 | #143 | SQL injection fix in custom-fields route | `fix/sql-injection-custom-fields` | 🔴 Open |
| #187 | #163 | GDPR N+1 parallelized | `fix/gdpr-n-plus-one` | 🔴 Open |
| #188 | #164 | SOC2 N+1 parallelized | `fix/soc2-n-plus-one` | 🔴 Open |
| #189 | #167 | verifySecret timing leak fix | `fix/timing-leak-verify-secret` | 🔴 Open |
| #190 | #174 | apiError + logError coordination | `fix/api-error-log-error` | 🔴 Open |
| #191 | #175 | superadmin errors strip details | `fix/superadmin-errors-strip-details` | 🔴 Open |
| — | #157 | Reduce as any assertions (partial batch) | `fix/as-any-assertions` | 🔴 Open |

### New GitHub Issues Created

| Issue | Title | Branch |
|-------|-------|--------|
| #160 | Superadmin error boundaries (BP#23) | `fix/superadmin-error-boundaries` |
| #161 | TOTP edge cases (BP#24) | `fix/totp-edge-cases` |
| #162 | DB singleton type safety (BP#25) | `fix/db-singleton-type-safety` |
| #163 | GDPR N+1 query (BP#26) | `fix/gdpr-n-plus-one` ✅ PR #187 |
| #164 | SOC2 N+1 query (BP#27) | `fix/soc2-n-plus-one` ✅ PR #188 |
| #165 | requestToJson parse errors (BP#28) | `fix/request-to-json-errors` |
| #166 | json().catch empty (BP#29) | `fix/json-parse-error-handling` |
| #167 | verifySecret timing leak (BP#30) | `fix/timing-leak-verify-secret` ✅ PR #189 |
| #168 | BigInt serialization (BP#31) | `fix/bigint-serialization` |
| #169 | dangerouslySetInnerHTML (BP#32) | `fix/dangerous-html-sanitize` |
| #170 | ESM/CJS mix (BP#33) | `fix/esm-cjs-consistency` |
| #171 | Log rotation (BP#34) | `fix/log-rotation` |
| #172 | Loki errors silent (BP#35) | `fix/loki-error-handling` |
| #173 | Alerting webhook (BP#36) | `feat/error-alerting-webhook` |
| #174 | apiError + logError (BP#37) | `fix/api-error-log-error` ✅ PR #190 |
| #175 | superadmin errors details (BP#38) | `fix/superadmin-errors-strip-details` ✅ PR #191 |
| #176 | Health check (BP#40) | `feat/health-check-endpoint` |
| #177 | Filesystem warning (BP#41) | `fix/next-dev-filesystem` |
| #178 | Notification RLS (BP#42) | `fix/notification-rls-errors` |
| #179 | DB sync error (BP#43) | `fix/db-sync-circular-dependency` |
| #180 | AI sentiment (BP#44) | `fix/ai-sentiment-population` |
| #181 | Server Action (BP#45) | `fix/missing-server-action` |
| #182 | Notification polling (BP#46) | `fix/notification-polling-error` |
| #183 | OpenAPI/Swagger (BP#47) | `feat/openapi-swagger-docs` |
| #184 | i18n (BP#49) | `feat/i18n-support` |
| #185 | FILTER(Boolean) type (BP#50) | `fix/filter-boolean-type` |

### Still Needed (No GitHub Issue Yet)
| BP# | Title | Branch |
|-----|-------|--------|
| 39 | Document cron CSRF skip | `docs/cron-csrf-documentation` |
| 51 | Duplicate jsdom override | `fix/duplicate-jsdom` |
| 52 | Package name mismatch | `fix/package-name` |
| 53 | Unused ANALYZE config | `fix/unused-analyze-config` |
| 54 | Unused STRIPE_PRICE_ID | `fix/unused-stripe-placeholders` |
| 55 | Merge conflict markers | `fix/merge-conflict-markers` |
| 56 | Branch protection | `ops/branch-protection` |

---

## REMAINING WORK (Priority Order)

### Critical Security
| Issue | Title | Branch | Est. |
|-------|-------|--------|------|
| #155 | 6 critical security issues | `fix/critical-security-issues` | 3hr |
| #129 | .env.local secrets in git | `fix/env-local-secrets` | 30min |

### High Priority
| Issue | Title | Branch | Est. | Status |
|-------|-------|--------|------|--------|
| #143 | SQL injection custom-fields | `fix/sql-injection-custom-fields` | 30min | ✅ PR #186 |
| #157 | 200+ as any assertions | `fix/as-any-assertions` | 4hr | 🔴 Partial fix pushed |
| #147 | 3067 ESLint warnings | `fix/eslint-warnings` | 4hr | 🔴 Not started |
| #158 | Notification system/hydration/pg | `fix/notification-system` | 3hr | 🔴 Not started |
| #134 | useEffect cleanup 40+ components | `fix/useeffect-cleanup` | 2hr | 🔴 Not started |
| #133 | Silent catch blocks | `fix/silent-catch-blocks` | 2hr | 🔴 Not started |
| #141 | 5 E2E tests failing | `fix/e2e-seed-data` | 30min | 🔴 Not started |
| #148 | Missing FK references | `fix/missing-fk-references` | 1hr | 🔴 Not started |
| #149 | Daily DB backups | `ops/daily-db-backups` | 1hr | 🔴 Not started |

### Medium Priority (Week 3)
| Issue | Title | Branch | Est. | Status |
|-------|-------|--------|------|--------|
| #160 | Superadmin error boundaries | `fix/superadmin-error-boundaries` | 30min | 🔴 Not started |
| #161 | TOTP edge cases | `fix/totp-edge-cases` | 20min | 🔴 Not started |
| #162 | DB singleton type safety | `fix/db-singleton-type-safety` | 10min | 🔴 Not started |
| #163 | GDPR N+1 | `fix/gdpr-n-plus-one` | 15min | ✅ PR #187 |
| #164 | SOC2 N+1 | `fix/soc2-n-plus-one` | 15min | ✅ PR #188 |
| #165 | requestToJson parse errors | `fix/request-to-json-errors` | 10min | 🔴 Not started |
| #166 | json().catch empty | `fix/json-parse-error-handling` | 20min | 🔴 Not started |
| #167 | verifySecret timing leak | `fix/timing-leak-verify-secret` | 10min | ✅ PR #189 |
| #168 | BigInt serialization | `fix/bigint-serialization` | 5min | 🔴 Not started |
| #169 | dangerouslySetInnerHTML | `fix/dangerous-html-sanitize` | 20min | 🔴 Not started |
| #170 | ESM/CJS mix | `fix/esm-cjs-consistency` | 30min | 🔴 Not started |
| #171 | Log rotation | `fix/log-rotation` | 15min | 🔴 Not started |
| #172 | Loki errors silent | `fix/loki-error-handling` | 10min | 🔴 Not started |
| #173 | Alerting webhook | `feat/error-alerting-webhook` | 30min | 🔴 Not started |
| #174 | apiError + logError coord | `fix/api-error-log-error` | 10min | ✅ PR #190 |
| #175 | superadmin errors strip details | `fix/superadmin-errors-strip-details` | 10min | ✅ PR #191 |
| #176 | Health check endpoint | `feat/health-check-endpoint` | 30min | 🔴 Not started |
| #177 | Filesystem warning | `fix/next-dev-filesystem` | 10min | 🔴 Not started |
| #178 | Notification RLS errors | `fix/notification-rls-errors` | 30min | 🔴 Not started |
| #179 | DB sync circular dep | `fix/db-sync-circular-dependency` | 1hr | 🔴 Not started |
| #180 | AI sentiment population | `fix/ai-sentiment-population` | 30min | 🔴 Not started |
| #181 | Missing Server Action | `fix/missing-server-action` | 10min | 🔴 Not started |
| #182 | Notification polling error | `fix/notification-polling-error` | 20min | 🔴 Not started |
| #183 | OpenAPI/Swagger docs | `feat/openapi-swagger-docs` | 2hr | 🔴 Not started |

### Low Priority
| Issue | Title | Branch | Est. | Status |
|-------|-------|--------|------|--------|
| #184 | i18n support | `feat/i18n-support` | 4hr | 🔴 Not started |
| #185 | FILTER(Boolean) type | `fix/filter-boolean-type` | 10min | 🔴 Not started |

### Phase Features
| Issue | Title | Branch | Status |
|-------|-------|--------|--------|
| #154 | Phase B: AI Auto-Follow-Up | `feat/ai-auto-followup` | 🔴 Not started |
| #156 | Phase D: Deliverability Engine | `feat/deliverability-engine` | 🔴 Not started |

### Test Coverage (Target: 100% lib/)
| Issue | Title | Branch | Status |
|-------|-------|--------|--------|
| #151 | Raise lib/ coverage thresholds | `test/coverage-lib` | ✅ Merged (PR #192) |
| #153 | Follow-ups coverage | `test/coverage-follow-ups` | 🔴 Not started |

---

## OPEN PULL REQUESTS

| PR | Title | Branch | Status |
|----|-------|--------|--------|
| #186 | fix: SQL injection custom-fields | `fix/sql-injection-custom-fields` | 🔴 Open |
| #187 | fix: GDPR N+1 parallelized | `fix/gdpr-n-plus-one` | 🔴 Open |
| #188 | fix: SOC2 N+1 parallelized | `fix/soc2-n-plus-one` | 🔴 Open |
| #189 | fix: verifySecret timing leak | `fix/timing-leak-verify-secret` | 🔴 Open |
| #190 | fix: apiError + logError coord | `fix/api-error-log-error` | 🔴 Open |
| #191 | fix: superadmin errors strip details | `fix/superadmin-errors-strip-details` | 🔴 Open |
| #157 | fix: Reduce as any (partial) | `fix/as-any-assertions` | 🔴 Open |

## RECENTLY MERGED

| PR | Title | Branch |
|----|-------|--------|
| #192 | test: increase lib/ coverage — 39 tests, raise thresholds | `test/coverage-increase-lib` ✅ |
| — | test: add 7 unit test files — 58 tests across lib modules | `test/coverage-batch-2` ✅ |

---

## KNOWN FRAGILE INTERFACES

| File | Used By | Danger Level |
|------|---------|-------------|
| `lib/branding.ts` | Branding, tenant layout, BrandingProvider | 🔴 High |
| `proxy.ts` | Auth, rate limiting, CSRF, public paths | 🔴 High |
| `lib/auth/api-handlers.ts` | Login, signup, auth flow | 🔴 High |
| `drizzle/schema/*.ts` | All features share schema registry | 🔴 High |
| `app/tenant/layout.tsx` | All tenant pages | 🟡 Medium |
| `lib/auth/csrf.ts` | CSRF across all API routes | 🟡 Medium |

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

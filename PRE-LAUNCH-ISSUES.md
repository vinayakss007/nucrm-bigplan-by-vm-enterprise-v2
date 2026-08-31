# Pre-Launch Issues

Generated: 2026-07-31
Last verified: 2026-08-31 (code re-audit; reconciled C3 rate limiting, C4 concurrency guards, and H6 CSP)

> **Status legend:** ✅ Resolved · ⚠️ Partially resolved · 🔴 Open

## CRITICAL

### 1. ✅ RESOLVED — SQL Injection via `sql.raw()` in Report Builder & Data Explorer

- **Files**: `app/api/tenant/reports/builder/route.ts`, `app/api/tenant/data-explorer/route.ts`
- **Verification (2026-08-31)**: No `sql.raw()` on user input remains. All dynamic
  identifiers go through `sql.identifier()` (safe quoting) **and** explicit
  allowlists (`ALLOWED_GROUP_FIELDS`, `ALLOWED_METRIC_FIELDS`, `EDITABLE_FIELDS`,
  `ENTITY_CONFIG.sortFields`). Values are always bound as parameters.
- Reference: Issue #683.

### 2. ✅ RESOLVED — Cross-Tenant Data Leak on Contacts Page

- **Verification (2026-08-31)**: Contacts list/detail queries filter on
  `eq(contacts.tenantId, ctx.tenantId)`, and `withApiRoute` pins a single DB
  connection for the whole handler so `setTenantContext()` + every query share
  it and RLS stays enforced (fix #1615). Detail routes add RBAC ownership checks.
- Reference: Issue #664.

### 3. ✅ RESOLVED — Rate Limiting on GET/PATCH/DELETE Endpoints

- **Verification (2026-08-31, re-audit)**: The global edge limiter in `proxy.ts`
  covers **all** non-public API paths (120 req/min per user, 300 req/min for
  API keys, 30 req/min unauthenticated). All mutating PATCH/DELETE routes are
  additionally covered by in-route `checkRateLimit()` / `rateLimitMutating()`.
- **Read-only GET analytics endpoints**: A defense-in-depth in-route layer was
  added for the 6 expensive analytics GET endpoints (`advanced`, `forecast`,
  `overview`, `scheduled-reports`, `stats`, `usage`) via the new
  `lib/api/read-rate-limit.ts` helper (`rateLimitRead`, analytics bucket =
  60 req/min). These endpoints now have **both** edge and in-route rate limiting.
- The open question ("decide whether read-only GET endpoints need rate limiting")
  is resolved — they have it.
- Reference: Issue #652.

### 4. ✅ RESOLVED — Optimistic Concurrency Guard on Entity Updates

- **Verification (2026-08-31, re-audit)**: Two guard patterns exist and are applied:
  - `withConcurrencyGuard()` + `updatedAtMs()` — contacts, deals, leads, tasks,
    quotes, products, meetings, email-templates.
  - `concurrencyGuard(db, table, id, tenantId, expectedUpdatedAt)` — companies,
    custom-entities, custom-entity rows, data-explorer inline edits, and the
    remaining business entities: `invoices/[id]/route.ts` (PUT),
    `orders/[id]/route.ts` (PUT), `tickets/[id]/route.ts` (PATCH),
    `contracts/[id]/route.ts` (PUT).
- **Confirmed**: Sub-resource routes (payments create, replies create, bulk POST,
  pdf GET, send POST) are create-only/list/pdf/send/bulk/delete actions that
  legitimately do not need optimistic locking. Config-style/singleton settings
  routes remain last-write-wins by design. No remaining business entity needs a
  guard.
- Reference: Issue #680.

### 5. ✅ RESOLVED — Secrets in `.env.local` Need Rotation + Secure Deployment

- **Verification (2026-08-31)**: `.gitignore` blanket-blocks `.env*` except
  `.env.example`. `deploy/.env.production` is tracked but contains **only
  placeholders** (`<<<REQUIRED>>>`), not real secrets. `deploy/generate-secrets.sh`
  - documented `openssl rand` workflow provide secure injection. Git-history
    scan for real secret values is clean.

---

## HIGH (significant risk — should fix)

### 6. ✅ RESOLVED — CSP `unsafe-inline` for Scripts in Production

- **File**: `proxy.ts` (`buildCsp(nonce)`)
- **Verification (2026-08-31, re-audit)**: Resolved via the nonce-based CSP in
  `proxy.ts` `buildCsp(nonce)` (issue #1070). Production `script-src` is
  `'self' 'nonce-${nonce}'` — no `'unsafe-inline'` for scripts in prod
  (`'unsafe-eval'` remains only in dev for Fast Refresh). `next.config.mjs`
  intentionally sets no static CSP. Only `style-src-attr` retains
  `'unsafe-inline'`, which is unavoidable for React inline styles.
- Reference: Issue #657, Issue #1070.

### 7. 36 Multi-Table Writes Not in `db.transaction()`

- **Reference**: Issue #685 (Batch 1 done in PR #714, Batch 2 pending)
- **Risk**: Partial writes leave DB in inconsistent state if one write succeeds and another fails.
- **Fix**: Wrap remaining multi-table writes in `db.transaction()`.
- **Effort**: 3-5 days

### 8. Deal Creation `stage_name` vs `stage` Resolution Bug

- **Files**: `app/api/tenant/deals/route.ts`, `app/api/tenant/deals/[id]/route.ts`
- **Risk**: Frontend sends `stage_name` (string like "won") but API expects `stage_id` (UUID). Fallback resolution has edge cases that fail silently.
- **Fix**: Robust `stage_name` → `stageId` resolution with validation. Reference: Issue #658.
- **Effort**: 1-2 days

### 9. Audit Filter Bugs + Session Invalidation Gaps

- **Reference**: Issue #661
- **Risk**: Audit logs may not filter correctly by tenant. Session invalidation after role changes is not immediate (cache gap in `middleware.ts` lines 115-118). Notification delivery may silently fail.
- **Fix**: Audit filter corrections, immediate session invalidation, notification delivery guarantees.
- **Effort**: 2-3 days

### 10. Migration Journal Duplicate Entries / Gaps

- **Reference**: Issue #682
- **Risk**: Drizzle migration journal has duplicate index entries and gaps — can cause migrations to run out of order or fail on fresh databases.
- **Fix**: Clean up `_journal.json`, remove duplicates, fill gaps.
- **Effort**: 1-2 days

---

## MEDIUM (quality/reliability)

### 11. 75 Stub Test Assertions (`expect(true).toBe(true)`)

- **Reference**: Issue #667
- **Risk**: Tests that don't actually test anything give false confidence in coverage.
- **Effort**: 2-3 days

### 12. Metrics Collection, Sync File Logging, Grafana Labels

- **Reference**: Issue #653
- **Risk**: Monitoring gaps — metrics may not be collected correctly, Grafana dashboards misaligned.
- **Effort**: 2-3 days

### 13. Missing API Route Tests, E2E Auth Tests, Tenant Isolation Tests

- **Reference**: Issue #666
- **Risk**: Many API routes lack integration/E2E tests. Hard to verify security-critical behaviors.
- **Effort**: 5+ days

### 14. Remaining Silent `catch(() => {})` Blocks

- **Risk**: ~23 instances across components/lib. Silent error swallowing hides bugs.
- **Effort**: 0.5-1 day

### 15. Pending PRs #552 and #553 Need Review/Merge

- **PR #552**: Missing re-exports in `drizzle/schema/infra.ts` (build-breaking)
- **PR #553**: `start-clean.sh` bootstrap script
- **Effort**: 0.5 day

---

## Confirmed Clean

| Area                            | Status                     |
| ------------------------------- | -------------------------- |
| TypeScript errors               | 0                          |
| Test failures                   | 0 (4771 passed, 7 skipped) |
| `.env` in git                   | Not tracked                |
| Dockerfile root user            | Fixed (runs as `nextjs`)   |
| `unsafe-eval` in production CSP | Only in dev mode           |

---

## Recommended Launch Order

_All CRITICAL items (#1–#5) are now resolved. HIGH #6 (CSP) is resolved. Remaining blockers below._

1. ✅ Rate limiting for read-only GET endpoints — done (edge + in-route analytics limiter) (CRITICAL #3)
2. ✅ Concurrency-guard coverage for remaining business entities — done (invoices, orders, tickets, contracts) (CRITICAL #4)
3. Fix deal creation stage resolution (HIGH #8)
4. ✅ Harden CSP policy — done (nonce-based CSP in `proxy.ts`, #1070) (HIGH #6)
5. Merge pending PRs #552 and #553 (MEDIUM #15)
6. Fix migration journal (HIGH #10)
7. Wrap remaining multi-table writes in transactions (HIGH #7) — phased

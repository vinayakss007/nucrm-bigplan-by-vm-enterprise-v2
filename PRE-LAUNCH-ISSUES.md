# Pre-Launch Issues

Generated: 2026-07-31
Last verified: 2026-08-31 (code re-audit)

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

### 3. ⚠️ PARTIALLY RESOLVED — Rate Limiting on GET/PATCH/DELETE Endpoints

- **Verification (2026-08-31)**: 182 of 314 tenant route files now call
  `checkRateLimit()` / `rateLimitMutating()`. All mutating PATCH/DELETE routes
  audited are covered. The remaining uncovered routes are predominantly
  **read-only GET** analytics/dashboard-widget endpoints (`analytics/*`,
  `dashboard/widgets/*`).
- **Remaining**: Decide whether read-only GET endpoints need rate limiting for
  launch (lower risk: no mutation, still an enumeration/DoS surface).
- Reference: Issue #652.

### 4. ⚠️ PARTIALLY RESOLVED — Optimistic Concurrency Guard on Entity Updates

- **Verification (2026-08-31)**: Two guard patterns exist and are applied:
  - `withConcurrencyGuard()` + `updatedAtMs()` — contacts, deals, leads, tasks,
    quotes, products, meetings, email-templates.
  - `concurrencyGuard(db, table, id, tenantId, expectedUpdatedAt)` (opt-in) —
    companies, and now custom-entities, custom-entity rows, and data-explorer
    inline edits.
- **Remaining**: A number of secondary/config-style routes still rely on
  last-write-wins by design (upsert/singleton settings). Confirm none of the
  remaining business entities (e.g. invoices, orders, tickets, contracts) need
  a guard before launch — several already send `updated_at`/`_version`.
- Reference: Issue #680.

### 5. ✅ RESOLVED — Secrets in `.env.local` Need Rotation + Secure Deployment

- **Verification (2026-08-31)**: `.gitignore` blanket-blocks `.env*` except
  `.env.example`. `deploy/.env.production` is tracked but contains **only
  placeholders** (`<<<REQUIRED>>>`), not real secrets. `deploy/generate-secrets.sh`
  - documented `openssl rand` workflow provide secure injection. Git-history
    scan for real secret values is clean.

---

## HIGH (significant risk — should fix)

### 6. CSP `unsafe-inline` for Scripts in Production

- **File**: `next.config.mjs` (line 71)
- **Risk**: Weakens XSS protection. `script-src 'self' 'unsafe-inline'` allows inline script injection.
- **Fix**: Implement `NEXT_SCRIPT_NONCE` strategy. Reference: Issue #657.
- **Effort**: 1-2 days

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

_CRITICAL #1, #2, #5 are resolved. Remaining blockers below._

1. ⚠️ Finish rate limiting decision for read-only GET endpoints (CRITICAL #3)
2. ⚠️ Confirm concurrency-guard coverage for remaining business entities (CRITICAL #4)
3. Fix deal creation stage resolution (HIGH #8)
4. Harden CSP policy (HIGH #6)
5. Merge pending PRs #552 and #553 (MEDIUM #15)
6. Fix migration journal (HIGH #10)
7. Wrap remaining multi-table writes in transactions (HIGH #7) — phased

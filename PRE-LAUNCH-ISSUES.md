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

### 7. ✅ RESOLVED — Multi-Table Writes Not in `db.transaction()`

- **Reference**: Issue #685 (Batch 1 in PR #714; Batch 2 here)
- **Verification (2026-08-31)**: A code re-audit found the remaining
  multi-table write paths (billing, lead-convert with tenant counters, signup,
  accept-invite, automation engine, inbound webhooks) already wrapped in
  `db.transaction()`. Batch 2 wrapped the two genuine gaps that remained:
  - `app/api/scim/v2/Users/route.ts` POST — the `users` upsert + `tenant_members`
    upsert (and the role lookup they depend on) are now one transaction, so a
    failed membership insert can no longer orphan a global `users` row.
  - `app/api/emergency/recover/route.ts` POST — the password reset (`users`) and
    session purge (`sessions`) are now atomic, so "reset + revoke" is
    all-or-nothing.
- **Risk (resolved)**: Partial writes leaving the DB inconsistent.

### 8. ✅ RESOLVED — Deal Creation `stage_name` vs `stage` Resolution Bug

- **Files**: `app/api/tenant/deals/route.ts`, `app/api/tenant/deals/[id]/route.ts`,
  `lib/deals/resolve-stage.ts`
- **Verification (2026-08-31)**: Stage resolution is centralized in
  `resolveDealStage()` (shared by create + update). It escapes LIKE
  metacharacters (the POST path previously did not, so a `%`/`_` in a stage name
  could resolve to the wrong stage), validates the resolved stage belongs to the
  tenant — and to `pipeline_id` when supplied — reports ambiguity instead of
  silently picking one same-named stage, and adopts the resolved stage's
  pipeline when `pipeline_id` is omitted so stage/pipeline stay consistent.
  Covered by `tests/unit/resolve-deal-stage.test.ts`. Reference: Issue #658.

### 9. ✅ RESOLVED — Audit Filter Bugs + Session Invalidation Gaps

- **Reference**: Issue #661
- **Verification (2026-08-31)**:
  - **Session invalidation**: `deleteUserSessions()` now also busts the
    `auth:context:` (permissions) cache — not just the `session:` cache — so a
    role change via the members route takes effect on the next request instead
    of after the 5-minute TTL. A new `invalidateUserContexts()` helper clears
    only permissions (keeping the user logged in), and the in-place role
    permission edit (`app/api/tenant/roles/[id]` PATCH) now calls it for every
    affected member.
  - **Audit filtering**: the `search` term is escaped with `escapeLike`, `from`/
    `to` dates are validated (invalid → 400) with a date-only `to` made
    inclusive of the whole day, and `edit_history` is correlated to the page's
    exact `(entity_type, entity_id)` pairs instead of two independent
    `IN (...)` subqueries (a cartesian mismatch).
  - **Notification delivery**: `createNotification` / `notifyTenantMembers`
    return a boolean delivery indicator (logged + signaled on retry exhaustion),
    and realtime push now fires on the retry path and for broadcasts.
  - Covered by `tests/unit/tenant-audit-filters.test.ts` and additions to
    `tests/unit/cache-sessions.test.ts`.

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
3. ✅ Fix deal creation stage resolution (HIGH #8) — done
4. Harden CSP policy (HIGH #6)
5. Merge pending PRs #552 and #553 (MEDIUM #15)
6. Fix migration journal (HIGH #10)
7. ✅ Wrap remaining multi-table writes in transactions (HIGH #7) — done
8. ✅ Audit filter + session invalidation + notification delivery (HIGH #9) — done

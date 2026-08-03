# Pre-Launch Issues

Generated: 2026-07-31

## CRITICAL (must fix before launch)

### 1. SQL Injection via `sql.raw()` in Report Builder & Data Explorer

- **Files**: `app/api/tenant/reports/builder/route.ts` (lines 195-199), `app/api/tenant/data-explorer/route.ts` (lines 98, 109, 122, 134, 145)
- **Risk**: User input interpolated into raw SQL via `sql.raw()`. Allowlist validation exists but can be bypassed if upstream paths skip it.
- **Fix**: Harden all `sql.raw()` call sites with explicit allowlists. Reference: Issue #683.
- **Effort**: 1-2 days

### 2. Cross-Tenant Data Leak on Contacts Page

- **Reference**: Issue #664
- **Risk**: Contacts from one tenant visible to another tenant. Wasted DB query + cross-tenant leak.
- **Fix**: Audit contacts query for missing tenant filter. Verify RLS policies.
- **Effort**: 1-2 days

### 3. No Rate Limiting on GET/PATCH/DELETE Endpoints

- **Reference**: Issue #652
- **Risk**: Only mutating POST endpoints have rate limiting. GET, PATCH, DELETE are unprotected — brute-force ID enumeration and DoS possible.
- **Fix**: Add `checkRateLimit()` calls to remaining routes.
- **Effort**: 2-3 days

### 4. No Optimistic Concurrency Guard on Entity Updates

- **Reference**: Issue #680
- **Risk**: Two simultaneous edits silently overwrite each other (lost update). Only contacts PATCH has a guard (`eq(contacts.updatedAt, existing.updatedAt!)`), not consistently applied.
- **Fix**: Add `updatedAt` check to all entity PATCH/PUT routes.
- **Effort**: 3-5 days

### 5. Secrets in `.env.local` Need Rotation + Secure Deployment

- **Files**: `.env`, `.env.local`
- **Risk**: Real DB passwords, JWT secrets, session secrets, encryption keys, Redis passwords in plaintext. Not in git, but travels with backups/deploys.
- **Fix**: Rotate all keys. Implement deployment secret injection (e.g., vault, cloud secrets manager). Ensure `.gitignore` covers all env files.
- **Effort**: 0.5 day

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

- **Files**: `app/api/tenant/deals/route.ts` (lines 115-136), `app/api/tenant/deals/[id]/route.ts` (lines 100-109)
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

1. Fix SQL injection in data-explorer & report-builder (CRITICAL #1)
2. Fix cross-tenant contacts leak (CRITICAL #2)
3. Rotate secrets + secure deployment injection (CRITICAL #5)
4. Add rate limiting to unprotected endpoints (CRITICAL #3)
5. Fix deal creation stage resolution (HIGH #8)
6. Harden CSP policy (HIGH #6)
7. Merge pending PRs #552 and #553 (MEDIUM #15)
8. Fix migration journal (HIGH #10)
9. Add optimistic concurrency guards (CRITICAL #4) — phased
10. Wrap remaining multi-table writes in transactions (HIGH #7) — phased

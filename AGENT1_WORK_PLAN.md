# Agent 1 Work Plan — Critical / Security / Infrastructure

**Date:** 2026-07-23
**GitHub Tracking:** https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/issues/688

## Rules (MANDATORY)

- Every fix MUST include unit tests covering the changed code (100% coverage on changed lines)
- Run `npx vitest run` before pushing
- Never commit to `main`. Always branch + PR targeting `main`
- Branch naming: `fix/<short-description>`

---

## My Issues (26) — Processing Order

### Phase 1: CRITICAL bugs — application broken right now

| #       | Issue                                                                                     | Branch                                       | PR                                                                                    | Status |
| ------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| 660/658 | Deal creation always fails (stage_name vs stage)                                          | `fix/deal-creation-stage-field`              | [PR #690](https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/pull/690) | DONE   |
| 661     | Session invalidation no-op; notifications no retry; queue missing types; junction deletes | `fix/session-invalidation-and-notifications` | Pushed (create PR via web UI)                                                         | DONE   |
| 667     | 75 expect(true).toBe(true) silent assertions                                              | `fix/silent-test-assertions`                 | Pushed (create PR via web UI)                                                         | DONE   |

### Phase 2: CRITICAL security — data at risk

| #   | Issue                                            | Branch                                     | PR                            | Status         |
| --- | ------------------------------------------------ | ------------------------------------------ | ----------------------------- | -------------- |
| 651 | Encryption key empty fallback; decrypt fail-open | `fix/encryption-fail-open`                 | Pushed (create PR via web UI) | DONE           |
| 648 | Hardcoded secrets; SAML/OIDC crypto bypass       | `fix/sso-crypto-bypass-and-auth-hardening` | Pushed (create PR via web UI) | DONE           |
| 649 | Missing permission checks; tenant isolation gaps | `fix/permission-checks-tenant-isolation`   | Pushed (create PR via web UI) | DONE           |
| 650 | Tickets hard DELETE; mass assignment in deals    | —                                          | —                             | FALSE POSITIVE |

### Phase 3: CRITICAL data integrity

| #   | Issue                                        | Branch                       | PR  | Status |
| --- | -------------------------------------------- | ---------------------------- | --- | ------ |
| 680 | Optimistic concurrency guard on all entities | `fix/concurrency-guard`      |     | DONE   |
| 679 | Wrap automation engine in db.transaction()   | `fix/automation-transaction` |     | DONE   |

### Phase 4: HIGH — multi-table writes + error handling

| #   | Issue                                                            | Branch                     | PR  | Status  |
| --- | ---------------------------------------------------------------- | -------------------------- | --- | ------- |
| 685 | Wrap multi-table writes in db.transaction (8 highest-risk files) | local changes              |     | DONE    |
| 681 | Replace 35 silent catch blocks with logging                      | `fix/silent-catch-logging` |     | PENDING |

### Phase 5: HIGH — security + infrastructure

| #       | Issue                                            | Branch                      | PR  | Status  |
| ------- | ------------------------------------------------ | --------------------------- | --- | ------- |
| 662     | SQL injection risk in restore; BigInt overflow   | `fix/sql-injection-restore` |     | PENDING |
| 652     | Missing rate limiting on PATCH/DELETE/GET        | `fix/rate-limiting-gaps`    |     | PENDING |
| 657     | CSP unsafe-eval/inline; weak sanitization        | `fix/csp-sanitization`      |     | PENDING |
| 656     | Docker runs as root; legacy-peer-deps            | `fix/docker-root-hardening` |     | PENDING |
| 663/659 | S3 backup env mismatch; email rate limits broken | `fix/s3-email-backup`       |     | PENDING |

### Phase 6: HIGH — data + UX bugs

| #   | Issue                                             | Branch                     | PR  | Status  |
| --- | ------------------------------------------------- | -------------------------- | --- | ------- |
| 665 | Data tables double-fetch; stale selectedIds       | `fix/data-tables-bugs`     |     | PENDING |
| 664 | Contacts page cross-tenant activities leak        | `fix/contacts-tenant-leak` |     | PENDING |
| 653 | Metrics never collected; sync file logging blocks | `fix/metrics-logging`      |     | PENDING |

### Phase 7: MEDIUM + LOW

| #   | Issue                                        | Branch                  | PR  | Status  |
| --- | -------------------------------------------- | ----------------------- | --- | ------- |
| 683 | Table/column allowlist for dynamic SQL       | `fix/sql-allowlist`     |     | PENDING |
| 682 | Fix migration journal duplicate idx entries  | `fix/migration-journal` |     | PENDING |
| 673 | lib/dlp.ts unused tenantId                   | `fix/dlp-tenantid`      |     | PENDING |
| 684 | Soft-delete on audit_logs + email tracking   | `fix/audit-soft-delete` |     | PENDING |
| 666 | No API route/E2E auth/tenant isolation tests | `fix/api-e2e-tests`     |     | PENDING |

---

## Completed

| #       | Issue                                                                                       | Branch                                       | PR              | Tests           |
| ------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------- | --------------- |
| 660/658 | Deal creation stage_name fix                                                                | `fix/deal-creation-stage-field`              | #690            | 3400 passing    |
| 661     | Session invalidation, notifications retry, queue registration, junction deletes             | `fix/session-invalidation-and-notifications` | Pushed (PR TBD) | 3400 passing    |
| 667     | Silent test assertions (84 `expect(true).toBe(true)` replaced)                              | `fix/silent-test-assertions`                 | Pushed (PR TBD) | 3398 passing    |
| 651     | Encryption fail-open removed; `getEncryptionKey()` added                                    | `fix/encryption-fail-open`                   | Pushed (PR TBD) | 3398 passing    |
| 648     | SAML/OIDC crypto bypass removed; proxy auth fixed; session invalidation on password reset   | `fix/sso-crypto-bypass-and-auth-hardening`   | Pushed (PR TBD) | 3398 passing    |
| 649     | Permission checks added (leads, meetings, orders, tasks); ticket replies scoped by tenantId | `fix/permission-checks-tenant-isolation`     | Pushed (PR TBD) | typecheck clean |

## False Positives / Won't Fix

| #     | Issue                                         | Reason                                                                                              |
| ----- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 650   | Tickets hard DELETE; mass assignment in deals | Tickets use soft delete (`deletedAt`); deals use Zod validation with field extraction — both safe   |
| MG-06 | Field permissions default-open                | Design decision — needs team input before changing                                                  |
| MG-12 | API key IP restrictions                       | Requires schema migration (no `allowedIp` column)                                                   |
| HG-20 | RLS context not scoped to transactions        | App-level `eq(table.tenantId, ctx.tenantId)` is primary defense; full fix requires massive refactor |

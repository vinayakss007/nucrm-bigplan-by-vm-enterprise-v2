# 3-Agent Task Division — Remaining Enterprise Work

## CRITICAL: Merge PR #859 First

PR #859 fixes 10 unit test failures on `main` that make all PRs show red CI. **Merge it before anything else.**

Also close PR #852 (superseded by #859) and PR #843 (duplicate of #847).

---

## Open PRs to Merge (22 PRs, all passing after #859 lands)

#840, #841, #844, #845, #846, #847, #848, #849, #850, #851, #853, #854, #855, #856, #857, #858, #860, #861

---

## Agent 1 — Infrastructure & DB Resilience

**Focus:** Make the database and infrastructure production-hardened.

| Task                                                                      | Issue   | Effort | Status |
| ------------------------------------------------------------------------- | ------- | ------ | ------ |
| DB pool health endpoint (`/api/system/db-health` — SELECT 1 + pool stats) | #674.1  | 2h     |        |
| Graceful pool drain on shutdown (handle SIGTERM)                          | #674.1  | 2h     |        |
| Encrypted backup (AES-256 before S3 upload) in backup-service.ts          | #675    | 4h     |        |
| S3 lifecycle policy config (docs/infra/s3-lifecycle.md)                   | #675    | 1h     |        |
| WAL archiving guide for managed PG (Neon PITR docs)                       | #675    | 1h     |        |
| Async bulk import endpoint (POST creates job → BullMQ processes)          | #52.2.5 | 4h     |        |
| Table partitioning guidance doc (which tables, why, how)                  | #52.1.2 | 2h     |        |

**Rules:** Branch per task. Run `npx vitest run` before pushing. Never commit to main.

---

## Agent 2 — Test Coverage & Code Quality

**Focus:** Raise coverage, refactor large files, close remaining test epics.

| Task                                                                                          | Issue | Effort | Status |
| --------------------------------------------------------------------------------------------- | ----- | ------ | ------ |
| workflow-executor.ts tests (step execution, retry, DLQ)                                       | #672  | 3h     |        |
| calendar-sync tests (service.ts, google.ts, outlook.ts mock)                                  | #672  | 3h     |        |
| Split docs-client.tsx (2305L) into sub-components                                             | #422  | 3h     |        |
| Split contact-detail-client.tsx (1053L)                                                       | #422  | 2h     |        |
| Remove remaining 4 coverage exclusions (lib/plugins, lib/storage, lib/db/services, lib/usage) | #641  | 3h     |        |
| Write tests for lib/storage/ (upload, presign, delete)                                        | #641  | 2h     |        |
| Audit all remaining hard-DELETEs in superadmin routes                                         | #676  | 2h     |        |

**Rules:** Branch per task. Run `npx vitest run tests/unit/your-file.test.ts` before pushing.

---

## Agent 3 — Features & UX Polish

**Focus:** Close remaining feature issues, UX improvements, documentation.

| Task                                                     | Issue    | Effort | Status |
| -------------------------------------------------------- | -------- | ------ | ------ |
| Add deal_forecasts UI tab on deal detail page            | #756.16  | 2h     |        |
| Quote generation from deal (PDF template + download)     | #756 ref | 4h     |        |
| Two-way email sync architecture doc                      | #52.4    | 2h     |        |
| Global search improvements (fuzzy match, result ranking) | UX       | 2h     |        |
| Dashboard widgets — real data instead of placeholders    | #757.14  | 3h     |        |
| Onboarding flow for new tenants (first-run wizard)       | UX       | 4h     |        |
| Email templates preview + inline editing                 | UX       | 3h     |        |

**Rules:** Branch per task. Always typecheck + lint before pushing.

---

## Issues to Close (Already Fixed)

These issues are fully resolved by merged PRs. Close them:

- **#644** — WebSocket (done in socket.io + Redis, merged)
- **#641** — Coverage thresholds (already at 70/70/80/70)
- **#639** — Debug console.log (already removed)
- **#638** — Schemas refactored (split into 13 domain files)
- **#637** — schema/utils.ts types (fixed)
- **#636** — Migration numbering (fixed in #814)
- **#667** — Silent assertions (all 84 fixed)
- **#681** — Silent catch blocks (all replaced with logging)
- **#664** — Cross-tenant leak (fixed)
- **#651** — Encryption key (fixed)
- **#660/658** — Deal creation (fixed)

---

## Coordination Rules

1. **Never commit to main** — always branch + PR
2. **Branch naming:** `fix/<short-description>` or `feat/<short-description>`
3. **If two agents need same file:** coordinate in this issue's comments. First to push wins; second rebases.
4. **Merge order:** #859 first, then all others in any order (they don't conflict)
5. **Test before push:** `npx vitest run` (or at minimum `npx vitest run tests/unit/your-test.test.ts`)
6. **Typecheck:** `npx tsc --noEmit` must pass with 0 errors
7. **Lint:** pre-commit hook runs `eslint --fix --no-warn-ignored --max-warnings=0` on staged files
8. **Node setup:** `export NVM_DIR="/root/.nvm" && . "$NVM_DIR/nvm.sh"` → Node v22.23.1
9. **Before commit:** `git checkout -- yarn.lock` (don't commit lockfile changes)

---

## Progress Tracking

| Agent              | PRs Shipped | Tests Added | Issues Closed |
| ------------------ | ----------- | ----------- | ------------- |
| Agent 1 (Infra)    | TBD         | TBD         | TBD           |
| Agent 2 (Quality)  | TBD         | TBD         | TBD           |
| Agent 3 (Features) | 65+ PRs     | 292 tests   | 50+ issues    |

Update this table as you complete tasks.

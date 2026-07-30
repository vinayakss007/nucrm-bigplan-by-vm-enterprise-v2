# Project Agent Rules

## PR Policy (MANDATORY)

1. **NEVER commit or push directly to `main`** — always create a feature branch and PR
2. **Branch naming**: `fix/<short-description>` (e.g., `fix/touch-targets`)
3. **PR base**: always target `main`
4. **Test after EVERY fix**: run `postman/full-test-suite.sh` and verify 100% pass rate before pushing
5. **One issue per PR** — keep PRs focused and reviewable

## Completed (Merged PRs #537–#551)

| PR   | Description                                                          |
| ---- | -------------------------------------------------------------------- |
| #537 | `fix(#496)` — migration safety: dry-run, --yes flags                 |
| #538 | `fix(#120)` — Zod validation on 8 critical API routes                |
| #539 | `fix(#469)` — dashboard empty state with real queries                |
| #540 | `fix(#409)` — remove unsafe JWKS fallback                            |
| #541 | `fix(#429)` — main follow-ups list page                              |
| #542 | `fix(#490)` — lead-to-contact Convert dialog                         |
| #543 | `fix(#495)` — offer send confirmation dialog                         |
| #544 | `fix(#492)` — module disable confirmation dialog                     |
| #545 | `fix(#489)` — form publish/unpublish confirmation dialog             |
| #546 | `fix(#488)` — superadmin impersonation confirmation dialog           |
| #547 | `fix(#491)` — bulk email send confirmation dialog                    |
| #548 | `fix(#493)` — pagination for forms, notifications, tickets           |
| #549 | fix: restore missing JSX closing tags in forms page                  |
| #550 | `feat(#430)` — Products CRUD API (GET/POST/PATCH/DELETE)             |
| #551 | `fix(#216 HP-4)` — replace 20 silent catch blocks with console.error |

## Pending (Awaiting Review — PRs #552–#553)

| PR   | Branch                         | Description                                                                                          |
| ---- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| #552 | `fix/infra-missing-re-exports` | Add missing re-exports to `drizzle/schema/infra.ts` (build was failing with 6 missing export errors) |
| #553 | `feat/start-clean-script`      | Add `start-clean.sh` — single-command bootstrap: build → migrate → seed → start                      |

## Agent 1 vs Agent 2 Task Division

### Agent 1 = Critical / Security / Infrastructure

Handles anything marked CRITICAL, security-related, or infrastructure stability:

| #    | Issue                                                              | Effort | Status                |
| ---- | ------------------------------------------------------------------ | ------ | --------------------- |
| #680 | Add optimistic concurrency guard on all entity updates             | Large  | Open                  |
| #685 | Wrap remaining 36 multi-table writes in db.transaction()           | Large  | ✅ Batch 1 in PR #714 |
| #667 | Fix 75 expect(true).toBe(true) assertions + E2E test cleanup       | Medium | Open                  |
| #661 | Fix audit filters, session invalidation, notification delivery     | Medium | Open                  |
| #658 | Fix deal creation (stage_name vs stage), tax rate, custom fields   | Medium | Open                  |
| #666 | Add API route tests, E2E auth tests, tenant isolation tests        | Large  | Open                  |
| #663 | Fix S3 backup env var mismatch, email rate limits, audit hash race | Medium | Open                  |
| #656 | Fix Docker: root user, legacy-peer-deps, .dockerignore, standalone | Medium | Open                  |
| #653 | Fix metrics collection, sync file logging, Grafana labels          | Medium | Open                  |
| #652 | Add rate limiting on PATCH/DELETE/GET endpoints                    | Medium | Open                  |
| #657 | Fix CSP unsafe-eval/inline, missing X-Powered-By, sanitization     | Medium | Open                  |
| #683 | Add table/column allowlist for dynamic SQL identifiers             | Medium | Open                  |
| #682 | Fix migration journal — duplicate idx entries and gaps             | Medium | Open                  |
| #688 | Agent Task Division epic — track & coordinate                      | Epic   | Open                  |

### Agent 2 = Features / Enhancements / UI

Handles high/medium priority feature work, frontend, and UX issues:

| #    | Issue                                                        | Effort | Status |
| ---- | ------------------------------------------------------------ | ------ | ------ |
| #665 | Fix data tables double-fetch on search, stale selectedIds    | Medium | Open   |
| #664 | Fix contacts page wasted DB query, cross-tenant leak, layout | Medium | Open   |
| #655 | Fix API response format inconsistency, accessibility gaps    | Medium | Open   |
| #654 | Add loading.tsx (126 pages) and error.tsx (94 pages)         | Large  | Open   |
| #440 | Quote/invoice email-send + PDF download                      | Medium | Open   |
| #431 | Quote-to-invoice conversion + PDF generation                 | Medium | Open   |
| #433 | Contract renewal reminders + expiry automation               | Medium | Open   |
| #435 | Customer self-service portal (tickets + invoices)            | Large  | Open   |
| #436 | Embeddable form JS widget + form analytics                   | Large  | Open   |
| #450 | Superadmin dashboard enhancements                            | Medium | Open   |
| #451 | Data explorer: visual query builder + CSV export             | Large  | Open   |
| #465 | Bulk actions on list pages                                   | Medium | Open   |
| #482 | Bulk select-all matching                                     | Small  | Open   |
| #158 | Notification system + hydration + dashboard fixes            | Medium | Open   |
| #152 | Follow-Up Intelligence system                                | Large  | Open   |
| #154 | AI Auto-Follow-Up opt-in + autonomous cron                   | Large  | Open   |
| #684 | Add deletedAt soft-delete to super_admin_audit_logs + email  | Small  | Open   |

### Low Priority / Backlog

| #    | Issue                                 | Effort |
| ---- | ------------------------------------- | ------ |
| #462 | Performance optimization              | Large  |
| #461 | Mobile/PWA support                    | Large  |
| #460 | i18n support                          | Large  |
| #422 | 25+ files exceed 500 lines (refactor) | Large  |
| #401 | BullMQ vs pg-boss redundancy          | Medium |
| #399 | Consolidate planning docs             | Small  |
| #239 | MCP testing infrastructure            | Large  |
| #219 | Schema migration split                | Medium |
| #173 | Real-time alerting                    | Large  |
| #98  | Prometheus metrics                    | Medium |
| #93  | RequestId logging                     | Small  |

### Overlap Rules

- Agent 1 takes CRITICAL/security first
- Agent 2 takes feature/enhancement work
- If unsure, ask before starting — no duplicate work
- Last updated: 2026-07-19

## Other Context

- **DB**: Use `DATABASE_URL` env var (see `.env.local`)
- **App**: `http://34.70.191.180:3000` — currently running in dev mode
- **Sign in**: `t@t.com` / `password123`
- **Build**: `npm run build` succeeds (needs ~5min, large project)
- **Tests**: 160/160 pass across 6 files. Full suite times out — run individual test files
- **Seed**: `npm run seed:dev` or `npm run start-clean` (auto-seeds)
- **Migrations**: `npm run db:migrate` (proper Drizzle migrations, not `drizzle-kit push`)

## Workflow Per Fix

```
1. git checkout main && git pull
2. git checkout -b fix/<description>
3. Make changes
4. Run test suite: bash postman/full-test-suite.sh
5. Verify 100% pass (0 failures)
6. git add -A && git commit -m "fix: <description> (Issue #290 Fix #N)"
7. git push origin fix/<description>
8. Create PR via GitHub API targeting main
9. Do NOT merge — wait for review
```

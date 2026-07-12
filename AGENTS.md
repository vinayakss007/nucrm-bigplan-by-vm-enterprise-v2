# Project Agent Rules

## PR Policy (MANDATORY)

1. **NEVER commit or push directly to `main`** — always create a feature branch and PR
2. **Branch naming**: `fix/<short-description>` (e.g., `fix/touch-targets`)
3. **PR base**: always target `main`
4. **Test after EVERY fix**: run `postman/full-test-suite.sh` and verify 100% pass rate before pushing
5. **One issue per PR** — keep PRs focused and reviewable

## Completed (Merged PRs #537–#551)

| PR | Description |
|----|------------|
| #537 | `fix(#496)` — migration safety: dry-run, --yes flags |
| #538 | `fix(#120)` — Zod validation on 8 critical API routes |
| #539 | `fix(#469)` — dashboard empty state with real queries |
| #540 | `fix(#409)` — remove unsafe JWKS fallback |
| #541 | `fix(#429)` — main follow-ups list page |
| #542 | `fix(#490)` — lead-to-contact Convert dialog |
| #543 | `fix(#495)` — offer send confirmation dialog |
| #544 | `fix(#492)` — module disable confirmation dialog |
| #545 | `fix(#489)` — form publish/unpublish confirmation dialog |
| #546 | `fix(#488)` — superadmin impersonation confirmation dialog |
| #547 | `fix(#491)` — bulk email send confirmation dialog |
| #548 | `fix(#493)` — pagination for forms, notifications, tickets |
| #549 | fix: restore missing JSX closing tags in forms page |
| #550 | `feat(#430)` — Products CRUD API (GET/POST/PATCH/DELETE) |
| #551 | `fix(#216 HP-4)` — replace 20 silent catch blocks with console.error |

## Pending (Awaiting Review — PRs #552–#553)

| PR | Branch | Description |
|----|--------|------------|
| #552 | `fix/infra-missing-re-exports` | Add missing re-exports to `drizzle/schema/infra.ts` (build was failing with 6 missing export errors) |
| #553 | `feat/start-clean-script` | Add `start-clean.sh` — single-command bootstrap: build → migrate → seed → start |

## Remaining

- **#462 Performance optimization** (Open) — comprehensive perf pass: bundle size reduction, image optimization, lazy loading, Redis caching, SWR, N+1 fixes, virtual scrolling, Lighthouse ≥90. Large effort — decide if/when to tackle.

## Other Context

- **DB**: `postgresql://nucrm:nucrm_prod_db_pass_2026@localhost:5432/nucrm`
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

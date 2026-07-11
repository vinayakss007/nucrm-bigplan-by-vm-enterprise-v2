# Project Agent Rules

## PR Policy (MANDATORY)

1. **NEVER commit or push directly to `main`** — always create a feature branch and PR
2. **Branch naming**: `fix/<short-description>` (e.g., `fix/touch-targets`)
3. **PR base**: always target `main`
4. **Test after EVERY fix**: run `postman/full-test-suite.sh` and verify 100% pass rate before pushing
5. **One issue per PR** — keep PRs focused and reviewable

## Issue Fix Order (from Issue #290)

Work through these sequentially, one PR per fix:

| # | Issue | Priority | Status |
|---|-------|----------|--------|
| 1 | Error pages leak internals | Critical | ✅ PR #437 |
| 2 | No heading hierarchy | Critical | ✅ PR #438 |
| 3 | No inline form validation | Critical | ✅ PR #463 |
| 4 | Silent error swallowing | Critical | ✅ PR #472 |
| 5 | i18n minimal | Medium | ⏭️ Cancelled (needs framework) |
| 6 | Mobile nav drawer a11y | Medium | ✅ PR #485 |
| 7 | Touch targets <44px | Medium | ✅ PR #484 |
| 8 | Inconsistent empty states | Medium | ✅ PR #486 |
| 9 | No accessibility E2E tests | Medium | ⏭️ Cancelled (needs framework) |
| 10 | Planning docs cleanup | Medium | ⏭️ Cancelled (low impact) |

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

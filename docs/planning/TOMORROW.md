# TODO — Tomorrow

## PRs TO MERGE (approve on GitHub first)
- [ ] **PR #240** — fix/production-readiness-0623 (CORS, notifications RLS, proxy)
- [ ] **PR #241** — fix/empty-catch-blocks (console.error in 10 files)

## AFTER PRs MERGED
- [ ] `git checkout main && git pull`
- [ ] `npm run build` — verify 0 errors
- [ ] `pm2 restart nucrm` — deploy

## REMAINING WORK (low priority)
- [ ] ~216 empty catch blocks across codebase (~4hrs)
- [ ] Wire email sentiment to deal metadata (~2hrs)
- [ ] Fix integration tests (backup-integrity, tenant-isolation) (~1hr)
- [ ] Fix E2E tests seed data (~1hr)
- [ ] Zod validation on API routes (~days — skip for MVP)

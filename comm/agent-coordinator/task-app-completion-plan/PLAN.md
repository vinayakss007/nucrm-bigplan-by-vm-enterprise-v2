# App Completion Plan

## Proposed Split

### Agent A (Backend/Infrastructure)
- [ ] **Fix ERR-005**: Announcement API 'body' vs 'content' field mismatch
- [ ] **Fix ERR-003**: `db.transaction` is not a function in notifications
- [ ] **Fix BUG-004**: Dashboard seed data showing instead of empty state
- [ ] **Schema Migration Plan**: Split missing tables into per-group migrations (#219)
- [ ] **Implement SSE log streaming** for real-time monitoring (#238)
- [ ] **Stress test script** for mass data insertion + API hammering (#237)
- [ ] **Pre-Phase-4 Fix Tracker**: Security, Stability & Code Quality (#216)

### Agent B (Frontend/UI)
- [x] **Fix BUG-002**: Onboarding page reappears after completion (PR #277)
- [x] **Fix BUG-003**: Dashboard contact count stale after creating new contact (PR #277)
- [x] **Fix BUG-006**: Contacts page 2-3s client-side load delay (PR #277)
- [x] **Fix BUG-008**: Email verification banner shown persistently (PR #277)
- [x] **Fix #160**: Add error.tsx boundary to superadmin/logs (PR #278)
- [ ] **Review & merge PR #275**: Task completion persistence fix (⚠️ Blocked: needs approving review from write-access member)
- [ ] **MCP-based testing infrastructure**: Playwright MCP, quality gate, Lighthouse (#239) — on hold per instructions

### Coordination
- [x] Sync via ./comm directory and GitHub Issues/PRs
- [ ] Update task.json status as items are completed
- [ ] Use `report_progress()` to update on blockers
- [x] Run `npm test` — all tests pass
- [ ] Run `npm run build` — times out (memory/scale issue, pre-existing)

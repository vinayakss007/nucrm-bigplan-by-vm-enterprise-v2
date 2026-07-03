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
- [ ] **Fix BUG-002**: Onboarding page reappears after completion
- [ ] **Fix BUG-003**: Dashboard contact count stale after creating new contact
- [ ] **Fix BUG-006**: Contacts page 2-3s client-side load delay
- [ ] **Fix BUG-008**: Email verification banner shown persistently
- [ ] **Review & merge PR #275**: Task completion persistence fix
- [ ] **MCP-based testing infrastructure**: Playwright MCP, quality gate, Lighthouse (#239)

### Coordination
- [ ] Sync via ./comm directory and GitHub Issues/PRs
- [ ] Update task.json status as items are completed
- [ ] Use `report_progress()` to update on blockers
- [ ] Run `npm run build && npm test` before marking done

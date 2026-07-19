# NuCRM Open Issues — Priority Breakdown

**Total Open Issues:** 43
**Last Updated:** 2026-07-18

---

## CRITICAL (Must Fix — Security/Data/Stability)

| #       | Issue                                                   | Problem                                                                                        | Impact                                |
| ------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| **396** | Revoke exposed Telegram bot token                       | Token leaked in public repo `.env.production`                                                  | Anyone with old clone can control bot |
| **216** | Pre-Phase-4 Fix Tracker (6 critical + 7 high + 7 infra) | JWT leak, CSRF bypass, .env in git, fake crypto, 3067 ESLint warnings, 300 silent catch blocks | Security holes, code quality debt     |
| **219** | Schema migration — 42 missing tables                    | Snapshot regenerated from schema files, not DB introspection                                   | Missing tables in production          |
| **158** | Fix notification system, hydration, pg bundle           | Notifications not wired, hydration errors, pg bundle issues                                    | Broken core features                  |
| **401** | BullMQ vs pg-boss queue redundancy                      | Two queue backends (Redis + Postgres) running simultaneously                                   | Operational complexity, confusion     |
| **600** | Structured UUID/ID system                               | Random UUIDs have no semantic meaning                                                          | No org awareness, poor DX             |

**Action:** Fix #396 immediately (token rotation). Then #216 security items. Then #219 schema migration. #158 and #401 can be parallelized.

---

## HIGH (Core Features — Business Value)

| #       | Issue                                       | Problem                                                     | Impact                            |
| ------- | ------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| **449** | Customer portal is empty                    | No portal pages, no portal auth, no ticket/invoice viewing  | Customers can't self-serve        |
| **435** | No customer self-service portal             | No portal for tickets, invoices, KB (related to #449)       | Reduced customer satisfaction     |
| **431** | Quote-to-invoice conversion + PDF           | No API to convert accepted quote to invoice, no PDF gen     | Manual billing workflow           |
| **440** | Quote/invoice email-send + PDF buttons      | No way to email quotes/invoices or download PDF             | Can't send invoices to customers  |
| **432** | Tenant-level audit log page + API           | Audit schema exists but no tenant-facing page/API           | No compliance visibility          |
| **428** | Module-aware sidebar                        | Sidebar shows all nav items regardless of installed modules | Confusing UX                      |
| **471** | Import/export wizards (CSV/XLSX)            | No bulk data import or export                               | Manual data entry only            |
| **465** | Bulk actions on list pages                  | No bulk delete, assign, status change on lists              | Tedious record management         |
| **482** | Bulk select all matching                    | Can only select visible items on current page               | Can't operate on full result sets |
| **479** | Workflow builder undo/redo + save indicator | No undo/redo, no save state feedback                        | Frustrating workflow UX           |

**Action:** #449+#435 can be combined into one portal feature. #431+#440 are tightly coupled (billing flow). #465+#482 are bulk actions (same PR).

---

## MEDIUM (Enhancement/Integration/UX)

| #       | Issue                                          | Problem                                            | Impact                            |
| ------- | ---------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| **483** | Workflow automation gaps vs HubSpot/Salesforce | 12 missing sub-features in automation engine       | Competitive gap                   |
| **470** | Calendar sync (Google/Outlook)                 | No calendar integration                            | Missed meetings                   |
| **467** | API documentation (OpenAPI/Swagger)            | No API docs for developers                         | Can't integrate externally        |
| **462** | Performance optimization                       | Large bundles, no lazy loading, no caching         | Slow page loads                   |
| **461** | Mobile/PWA support                             | Desktop-only, no responsive layout                 | Can't use on phones               |
| **460** | i18n/l10n support                              | English-only, no translations                      | Non-English users excluded        |
| **458** | Email template drag-and-drop editor            | Plain textarea, no visual editor                   | Poor email UX                     |
| **451** | Data explorer visual query builder             | Raw SQL only, no filter UI                         | Unusable for non-technical admins |
| **450** | Superadmin dashboard improvements              | Static tenant table, no search/usage graphs        | Poor admin visibility             |
| **436** | Embeddable form widget + analytics             | No JS widget for external sites, no form analytics | Can't embed forms                 |
| **433** | Contract renewal reminders                     | No automated renewal tracking                      | Missed renewals                   |
| **424** | Plan offerings matrix UI                       | Module pricing per plan is hardcoded               | Can't manage plans in UI          |
| **423** | Per-customer feature overrides UI              | Backend exists, needs admin UI                     | Can't customize per-customer      |

**Action:** Group by feature area — billing (#433, #424, #423), integrations (#470), admin UX (#450, #451, #428), developer experience (#467, #462).

---

## LOW (Tech Debt/Cleanup/Optional)

| #       | Issue                                | Problem                                  | Impact               |
| ------- | ------------------------------------ | ---------------------------------------- | -------------------- |
| **422** | 25+ files exceed 500 lines           | Large files hard to maintain             | Code maintainability |
| **399** | Consolidate root-level planning docs | 17+ markdown files at root               | Confusion            |
| **52**  | Enterprise infrastructure epic       | Observability, resilience, scale         | Long-term roadmap    |
| **239** | MCP-based testing infrastructure     | Playwright MCP, quality gate, Lighthouse | Testing automation   |
| **184** | i18n support (duplicate of #460)     | —                                        | —                    |
| **183** | OpenAPI/Swagger (duplicate of #467)  | —                                        | —                    |
| **173** | Real-time error alerting             | No Slack/PagerDuty webhook               | No alerting          |
| **156** | Deliverability Engine gaps           | Spam check, bounce handling              | Email deliverability |
| **154** | AI Auto-Follow-Up cron               | Autonomous AI follow-ups                 | Advanced feature     |
| **153** | Test coverage for follow-ups         | Low test coverage                        | Code quality         |
| **152** | Follow-Up Intelligence (Phase A)     | Follow-up tracking system                | Feature              |
| **98**  | Prometheus metrics endpoint          | Metrics exist but may need hardening     | Observability        |
| **93**  | requestId for distributed tracing    | Tracing infrastructure                   | Debugging            |
| **566** | Coordination plan (meta-issue)       | Agent work split                         | Planning             |

**Action:** #184 and #183 are duplicates — close them. #566 is a coordination doc — close after work is done. #52 is an epic — break into smaller issues.

---

## Recommended Execution Order

### Sprint 1: Security + Stability (CRITICAL)

1. **#396** — Rotate Telegram token (30 min)
2. **#216** — Fix 6 critical security items (JWT leak, CSRF, .env, crypto) (1-2 days)
3. **#219** — Schema migration for 42 missing tables (1 day)
4. **#158** — Fix notifications, hydration, pg bundle (1 day)
5. **#401** — Pick one queue backend (BullMQ or pg-boss) (1 day)

### Sprint 2: Core Features (HIGH)

6. **#449+#435** — Customer portal (3-5 days)
7. **#431+#440** — Quote→Invoice flow + PDF + email (2-3 days)
8. **#432** — Tenant audit log page + API (1-2 days)
9. **#465+#482** — Bulk actions on lists (1-2 days)
10. **#428** — Module-aware sidebar (1 day)

### Sprint 3: Enhancements (MEDIUM)

11. **#471** — Import/export wizards (2-3 days)
12. **#467** — API documentation (1-2 days)
13. **#462** — Performance optimization (2-3 days)
14. **#450+#451** — Superadmin dashboard + data explorer (2-3 days)
15. **#600** — Structured UUID/ID system (2-3 days)

### Sprint 4: Polish (MEDIUM/LOW)

16. **#479** — Workflow builder UX (1-2 days)
17. **#470** — Calendar sync (3-5 days)
18. **#458** — Email template editor (2-3 days)
19. **#436** — Form widget + analytics (2-3 days)
20. **#433** — Contract renewal reminders (1-2 days)

### Backlog (LOW)

- #422 — Refactor large files
- #399 — Consolidate docs
- #461 — Mobile/PWA
- #460 — i18n
- #239 — MCP testing
- #173 — Error alerting
- #156 — Deliverability engine
- #154 — AI auto-follow-up
- #152+#153 — Follow-ups system + tests

---

## Quick Wins (< 1 hour each)

| #   | Task                                     |
| --- | ---------------------------------------- |
| 396 | Rotate Telegram bot token                |
| 399 | Consolidate root docs into docs/ folder  |
| 184 | Close duplicate (same as #460)           |
| 183 | Close duplicate (same as #467)           |
| 566 | Close coordination doc (work is planned) |
| 428 | Filter sidebar by tenantModules          |
| 173 | Add Slack webhook for error alerts       |
| 93  | Verify requestId is working              |

---

## Dependencies

```
#396 (token) ──────────────────────── independent
#216 (security fixes) ──────────────── independent
#219 (schema migration) ────────────── independent
#158 (notifications/hydration) ──────── independent
#401 (queue consolidation) ──────────── independent
#600 (structured IDs) ──────────────── independent
#449+#435 (portal) ─────────────────── depends on auth system
#431+#440 (billing flow) ───────────── depends on quotes/invoices schema
#432 (audit log) ───────────────────── depends on editHistory schema
#465+#482 (bulk actions) ────────────── independent
#428 (module sidebar) ──────────────── depends on tenantModules table
#471 (import/export) ───────────────── independent
#467 (API docs) ────────────────────── independent
#462 (performance) ─────────────────── independent
#479 (workflow UX) ─────────────────── depends on workflow engine
#470 (calendar sync) ───────────────── independent
#458 (email editor) ────────────────── depends on email templates
#436 (form widget) ─────────────────── depends on forms schema
#433 (contract reminders) ──────────── depends on contracts schema
```

---

## Summary

| Priority  | Count  | Sprint     |
| --------- | ------ | ---------- |
| CRITICAL  | 6      | Sprint 1   |
| HIGH      | 10     | Sprint 2   |
| MEDIUM    | 13     | Sprint 3-4 |
| LOW       | 14     | Backlog    |
| **Total** | **43** | —          |

**Estimated effort:** ~40-50 dev days for all issues
**Recommended focus:** Sprints 1-2 (CRITICAL + HIGH) = ~15-20 dev days

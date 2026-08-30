# Roadmap & Backlog

A snapshot of tracked work, mirrored from the project rules in
[`AGENTS.md`](../../AGENTS.md). **GitHub Issues remain the source of truth** — this page is a
readable overview and orientation, not a live tracker.

> Keep this in sync with `AGENTS.md` when the task division changes.

---

## Task division

Work is split between two tracks to avoid duplication:

- **Agent 1 — Critical / Security / Infrastructure:** anything CRITICAL, security-related, or about
  infrastructure stability.
- **Agent 2 — Features / Enhancements / UI:** high/medium feature, frontend, and UX work.

**Overlap rules:** Agent 1 takes CRITICAL/security first; Agent 2 takes feature/enhancement work;
if unsure, ask before starting — no duplicate work.

---

## Agent 1 — Critical / Security / Infrastructure

| # | Item | Effort | Status |
| --- | --- | --- | --- |
| #680 | Optimistic concurrency guard on all entity updates | Large | Open |
| #685 | Wrap remaining multi-table writes in `db.transaction()` | Large | Batch 1 in PR #714 |
| #667 | Fix `expect(true).toBe(true)` assertions + E2E cleanup | Medium | Open |
| #661 | Fix audit filters, session invalidation, notification delivery | Medium | Open |
| #658 | Fix deal creation (stage_name vs stage), tax rate, custom fields | Medium | Open |
| #666 | API route tests, E2E auth tests, tenant isolation tests | Large | Open |
| #663 | Fix S3 backup env var mismatch, email rate limits, audit hash race | Medium | Open |
| #656 | Fix Docker: root user, legacy-peer-deps, .dockerignore, standalone | Medium | Open |
| #653 | Fix metrics collection, sync file logging, Grafana labels | Medium | Open |
| #652 | Rate limiting on PATCH/DELETE/GET endpoints | Medium | Open |
| #657 | Fix CSP unsafe-eval/inline, missing X-Powered-By, sanitization | Medium | Open |
| #683 | Table/column allowlist for dynamic SQL identifiers | Medium | Open |
| #682 | Fix migration journal — duplicate idx entries and gaps | Medium | Open |
| #688 | Agent Task Division epic — track & coordinate | Epic | Open |

---

## Agent 2 — Features / Enhancements / UI

| # | Item | Effort | Status |
| --- | --- | --- | --- |
| #665 | Fix data-table double-fetch on search, stale selectedIds | Medium | Open |
| #664 | Fix contacts page wasted query, cross-tenant leak, layout | Medium | Open |
| #655 | Fix API response format inconsistency, accessibility gaps | Medium | Open |
| #654 | Add `loading.tsx` (126 pages) and `error.tsx` (94 pages) | Large | Open |
| #440 | Quote/invoice email-send + PDF download | Medium | Open |
| #431 | Quote-to-invoice conversion + PDF generation | Medium | Open |
| #433 | Contract renewal reminders + expiry automation | Medium | Open |
| #435 | Customer self-service portal (tickets + invoices) | Large | Open |
| #436 | Embeddable form JS widget + form analytics | Large | Open |
| #450 | Superadmin dashboard enhancements | Medium | Open |
| #451 | Data explorer: visual query builder + CSV export | Large | Open |
| #465 | Bulk actions on list pages | Medium | Open |
| #482 | Bulk select-all matching | Small | Open |
| #158 | Notification system + hydration + dashboard fixes | Medium | Open |
| #152 | Follow-Up Intelligence system | Large | Open |
| #154 | AI Auto-Follow-Up opt-in + autonomous cron | Large | Open |
| #684 | Soft-delete (`deletedAt`) on `super_admin_audit_logs` + email | Small | Open |

---

## Low priority / backlog

| # | Item | Effort |
| --- | --- | --- |
| #462 | Performance optimization | Large |
| #461 | Mobile / PWA support | Large |
| #460 | i18n support | Large |
| #422 | 25+ files exceed 500 lines (refactor) | Large |
| #401 | BullMQ vs pg-boss redundancy | Medium |
| #399 | Consolidate planning docs | Small |
| #239 | MCP testing infrastructure | Large |
| #219 | Schema migration split | Medium |
| #173 | Real-time alerting | Large |
| #98 | Prometheus metrics | Medium |
| #93 | RequestId logging | Small |

---

## Recently completed (merged)

A run of confirmation-dialog, validation, and CRUD work shipped in **PRs #537–#551** (e.g. migration
safety, Zod validation on critical routes, convert/send/disable/publish/impersonate confirmation
dialogs, pagination, Products CRUD API, structured error logging). See `AGENTS.md` for the full
list, plus pending review PRs (#552–#553).

---

## Related

- Source of truth: [`AGENTS.md`](../../AGENTS.md) and the GitHub issue tracker
- Onboarding hub: [`docs/agent-plans/README.md`](../agent-plans/README.md)
- Contributing & Operations: [`docs/admin/contributing-and-operations.md`](../admin/contributing-and-operations.md)

_Last synced from `AGENTS.md`: task division updated 2026-07-19._

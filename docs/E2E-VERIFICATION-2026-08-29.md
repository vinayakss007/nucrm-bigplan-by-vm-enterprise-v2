# End-to-End Verification against a live database — 2026-08-29

This report records an end-to-end run of NuCRM against a **real PostgreSQL
instance** (not mocks): provision → migrate → seed → build → exercise routes and
DB operations → full test suite. It documents what is verified working, what was
improved this session, and the one environmental caveat found.

## TL;DR

- **The application builds, migrates, seeds, and runs its full test suite green
  against a real database.** No genuine product defects were found in this pass.
- **Schema builds from empty** via `npm run db:migrate` (81 migrations, 2668
  statements, 0 errors, 224 tables).
- **Full suite: 347 files, 5610 passed, 7 skipped, 0 failed** against live PG.
- Every route exercised (28 GET routes + core CRM CRUD + this session's fixes)
  executed real queries successfully.
- Security features that CI can never test (RLS, tenant isolation, connection
  pinning) were exercised against a live DB and **pass**.

## Environment

| Item           | Value                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | 15.18 (local)                                                                                                        |
| DB URL (local) | `postgresql://postgres@/nucrm?host=/var/run/postgresql` (unix socket)                                                |
| `DATABASE_SSL` | `false` for local                                                                                                    |
| Node           | 20.x                                                                                                                 |
| Seed           | `npm run seed:dev` → tenant `demo`, users `admin@test.com` / `manager@` / `rep1@` / `rep2@` (password `password123`) |

Note: in the sandbox used for this run, TCP loopback (`127.0.0.1`) is blocked, so
the DB was reached over a **unix socket**. A normal local dev machine uses the
TCP URL from `.env.example` unchanged.

## Steps and results

### 1. Migrations — PASS

`npm run db:migrate` applied all 81 journalled migrations from an empty database:
2668 statements applied, 0 errors, 224 base tables created. Includes migration
`0081` (the `snapshot_tenant_usage()` repair, PR #1627).

See `docs/migration-chain-state.md` for the runner distinction: `db:migrate`
builds a fresh schema successfully; drizzle's native `db:verify-chain` still
fails on the historical lineage overlap.

### 2. Seed — PASS

`npm run seed:dev` populated the demo tenant with contacts (56), deals (35),
tickets, notifications, automations, plans, etc.

### 3. Build — PASS

`npm run build` → "Compiled successfully". All 478 pages generated; ~480 API
routes compiled. The `[portal-session] Dynamic server usage` log lines are
expected (portal pages use cookies and correctly opt out of static rendering).

### 4. Route + DB exercise (in-process handlers, real DB) — PASS

Handlers were imported and invoked with a real seeded auth context against the
live DB (auth/permission gates mocked; everything else real).

- **Core CRM CRUD** — contacts list + create + persisted read-back; deals list
  returns the standard `{ data, total }` envelope.
- **28 GET routes** all returned `200` executing real tenant-scoped queries:
  contacts, companies, deals, leads, tasks, tickets, invoices, quotes, products,
  orders, contracts, subscriptions, activities, pipelines, segments,
  notifications, kb/articles, canned-responses, sla, csat/stats, email/analytics,
  leaderboards, analytics/usage, analytics/forecast, reports/builder, search,
  usage-status, ai/insights. None required extra params.
- **`snapshot_tenant_usage()`** runs with no error and writes real counts
  (demo tenant: 56 contacts, 35 deals, 4 users). `api_calls_count` and
  `storage_used_mb` are `0` as documented — the per-request API-call counter is
  not yet wired (tracked separately), which is expected, not a defect.

### 5. This session's fixes — VERIFIED on live DB

| Fix (PR)                                           | Live verification                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Segments CRUD (#1628)                              | `POST` creates (plural→singular `entity_type`, correct `filter_count`), `GET` lists it, `DELETE` removes it, missing id → `404`.                                                                       |
| Email engagement analytics (#1628)                 | `GET /api/tenant/email/analytics` returns real JSON (`totalTracked/opens/clicks/openRate/clickRate/byCampaign/events`), not the tracking-pixel GIF.                                                    |
| Deals kanban shape (#1628)                         | Deals list returns `{ data }`; the client now reads `data`.                                                                                                                                            |
| Ticket-reply merge fields (#1628)                  | Posting `Hi {{contact.first_name}} — {{agent.name}}` stored as `Hi James — Admin Test`; no raw `{{` remained (verified by reading the row back).                                                       |
| AI endpoints no longer canned (#1628)              | With no AI provider configured: `/ai/insights` → `200` with `ai:false` (deterministic fallback, not faked model text); `/ai/email-draft` → `503` (gateway reports no provider), not a canned template. |
| Invoices `{data}` + filtered count (#1623, merged) | Covered by the green billing/invoice integration tests below.                                                                                                                                          |
| Deal bulk-delete counter (#1625, merged)           | Covered by unit tests.                                                                                                                                                                                 |
| Usage-snapshot repair (#1627, merged)              | `snapshot_tenant_usage()` verified above.                                                                                                                                                              |

### 6. Security / DB integration tests (previously un-runnable without a DB) — PASS

These self-skip in CI (no database) and had never been executed there:

- `tenant-isolation` — 7/7 pass. RLS confirmed enabled on companies, contacts,
  deals, leads, tasks, tenants, users.
- `rls-connection-affinity` — 4/4 pass (per-request connection pinning, #1615).
- `backup-integrity`, `critical-coverage`, `vulnerability-security` — 67 passed,
  7 skipped (need external services), 0 failed.

### 7. Full test suite against live DB — PASS

`vitest run tests/unit tests/integration` with a live DB and `ENCRYPTION_KEY`
set: **347 files, 5610 passed, 7 skipped, 0 failed.** The integration tests that
previously failed only due to a missing DB / `ENCRYPTION_KEY` now pass.

## What improved this session (merged to `main`)

- **#1623** — invoices list returns `{ data }` (page was permanently empty) and
  the total count respects filters.
- **#1625** — bulk-delete decrements the tenant `currentDeals` counter (was
  drifting upward and could wrongly exhaust the plan limit).
- **#1627** — repaired `snapshot_tenant_usage()`, which inserted into
  non-existent columns and threw on every hourly cron run, so usage snapshots
  were never written.

## Open (in review) — #1628

Segments CRUD, email-analytics endpoint, deals-kanban shape, real AI
`email-draft`/`insights`, ticket-reply merge fields, and marketing-copy accuracy.
All verified working in this run.

## Caveat found (not a product defect)

`db:verify-chain` (drizzle's native migrator) still cannot build a fresh schema
because of two overlapping migration lineages (`0000_init` vs the `flat_sir_ram`
snapshot). The production runner `db:migrate` absorbs this and builds
successfully. Squashing the history to a single baseline would make both runners
agree — see `docs/migration-chain-state.md`.

## Follow-ups already tracked

- #1630 real server-side PDF, #1631 recurring-invoice cron, #1632 multi-step
  approval chains, #1633 segment dynamic-filter evaluation + sequence sync.

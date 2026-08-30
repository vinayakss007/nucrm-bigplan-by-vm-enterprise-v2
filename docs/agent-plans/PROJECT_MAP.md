<!--
  NuCRM Enterprise — Property of abetworks.in
  Copyright (c) 2026 abetworks.in. All Rights Reserved.
  Proprietary & confidential. Unauthorized copying or distribution is prohibited.
-->

# Project Map

> A fast orientation to the codebase: what lives where, how the layers stack,
> and which conventions to follow. Use this to answer _"where is X and what
> pattern does it use?"_ before you start editing.
>
> For deep architecture, see [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md).
> For the rules, see [`README.md`](./README.md).

---

## 1. Stack

| Layer        | Tech                                                 |
| ------------ | ---------------------------------------------------- |
| Framework    | **Next.js 16** (App Router), **React 19**            |
| Language     | **TypeScript 5.9** (strict; no `any`)                |
| Validation   | **Zod 4**                                            |
| DB / ORM     | **PostgreSQL** + **Drizzle ORM 0.45** (~215 tables)  |
| Auth         | JWT/session; tenant context + RLS connection pinning |
| Runtime      | Node 22 (nvm in the sandbox)                         |
| Process mgmt | **pm2** in production (monitoring stack in Docker)   |
| Errors       | Custom `logError` → `error_logs` table + Sentry      |

---

## 2. Top-level directories

```
app/                Next.js App Router — pages + API routes
  tenant/           Tenant-facing app (the CRM itself) — ~50 feature areas
  portal/           Customer self-service portal (protected)
  superadmin/       Platform admin (dark theme, its own tokens)
  auth/             Login/signup/reset/invite
  (marketing)/      Public marketing pages
  api/              Route handlers (see §4)
  layout.tsx, error.tsx, loading.tsx, global-error.tsx, globals.css
components/
  tenant/           Client components for tenant features
  portal/           Portal client components
  superadmin/       Superadmin client components
  shared/           Cross-cutting (empty-state, error-boundary, ...)
  ui/               Design-system primitives (button, card, data-table, error-boundary, ...)
lib/                Business logic + infrastructure (see §5)
drizzle/
  schema/           One .ts per domain (core, crm, billing, automation, ...) + index.ts
  db.ts             The db client
hooks/              Reusable React hooks (data fetching, etc.)
types/              Shared TS types (incl. ModuleManifest)
scripts/            ~45 ops scripts (migrate, seed, verify-*, diagnose, ...)
tests/              unit/ integration/ e2e/ dashboard/ load/ + helpers
monitoring/         Prometheus / Grafana / Alertmanager / Promtail (Docker)
docs/               Reference docs (this hub lives in docs/agent-plans/)
.kiro/steering/     Global standards, scaling, agent coordination
```

---

## 3. Request lifecycle (tenant data)

```
Browser ──▶ app/tenant/<area>/page.tsx        (server component: fetch + typed props)
                 │  delegates interactivity to
                 ▼
        components/tenant/<area>-client.tsx     (client component)
                 │  calls
                 ▼
        app/api/tenant/<area>/route.ts          (withApiRoute → pinned connection / RLS)
                 │  auth (requireAuth/requireTenantCtx) → Zod validate → rate-limit
                 ▼
        lib/<domain>/*                           (business logic/service)
                 │
                 ▼
        drizzle/schema/<domain>.ts               (tenant-scoped queries; RLS backstop)
```

Two isolation layers work together: **app-level** `tenant_id` filters on every
query, and **RLS** enforced because `withApiRoute` runs the whole handler under
one pinned connection with the tenant GUC set (`lib/api/with-api-route.ts`,
Issue #1615). Always keep both.

---

## 4. API routes (`app/api/`)

Grouped by audience/purpose:

| Group                                        | Purpose                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `tenant/`                                    | The bulk of the app's endpoints (per-tenant CRUD, analytics, admin)                        |
| `auth/`                                      | Authentication flows                                                                       |
| `portal/` (under `public`/`user`)            | Customer portal endpoints                                                                  |
| `superadmin/`, `super-admin/`, `admin/`      | Platform administration                                                                    |
| `cron/`                                      | Scheduled jobs (backup, sequences, reminders, checks) — system-wide, no per-request tenant |
| `webhooks/`                                  | Inbound third-party webhooks (Stripe, etc.)                                                |
| `v1/`, `v2/`                                 | Versioned public API surface                                                               |
| `flags/`, `metrics/`, `health/`, `openapi/`  | Ops/introspection                                                                          |
| `embed/`, `track/`, `forms/`, `unsubscribe/` | Public embeddable/marketing endpoints                                                      |

**Route conventions:** `withApiRoute(...)` wrapper, `requireAuth`/`requireTenantCtx`,
Zod validation (`lib/api/validate`, `lib/api/schemas`), `rateLimitMutating` on
writes, `db.transaction(...)` for multi-table writes, `logError` + `apiError`
for failures, `{ data }` response envelope (`lib/api/response-envelope.ts`).
See [`FEATURE_ADDITION_PLAN.md` §3](./FEATURE_ADDITION_PLAN.md#3-api-layer-route-handlers)
for a full template, and `app/api/tenant/activities/route.ts` as a live example.

---

## 5. `lib/` — where logic lives

Key entries (non-exhaustive):

| Path                                                                                                                         | Responsibility                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/api/`                                                                                                                   | Route infrastructure: `with-api-route.ts`, `validate.ts`, `schemas/`, `response-envelope.ts`, `mutating-rate-limit.ts`, `with-transaction.ts`, `optimistic-lock.ts`, `idempotency.ts`, pagination |
| `lib/db/`                                                                                                                    | Connection pool (`pool.ts` — the singleton), request-connection pinning                                                                                                                           |
| `lib/auth/`, `lib/tenant/`                                                                                                   | Auth middleware + tenant context (`requireAuth`, `requireTenantCtx`)                                                                                                                              |
| `lib/errors-server.ts` / `errors-client.ts`                                                                                  | **`logError`** — structured logging (levels: `warning`/`error`/`fatal`)                                                                                                                           |
| `lib/modules/`                                                                                                               | Module system: `registry.ts` (`BUILTIN_MODULES`), `gate.ts` (`requireModule`/`requireFeature`), `client-gate.tsx`, `lazy-loader.tsx`                                                              |
| `lib/feature-flags.ts`                                                                                                       | Runtime flags: `isFeatureEnabled(flag, { tenantId, userId })`                                                                                                                                     |
| `lib/cache/`                                                                                                                 | Tenant-scoped caching (`tenant:{tenantId}:{resource}`)                                                                                                                                            |
| `lib/billing/`, `lib/automation/`, `lib/ai/`, `lib/analytics/`, `lib/email/`, `lib/audit/`, `lib/compliance/`, `lib/export/` | Domain services                                                                                                                                                                                   |

**Rules:** use the singleton pool (never `new Pool()` in a request path); keep
AI behind the gateway with deterministic fallbacks; scope cache keys by tenant.

---

## 6. Data model (`drizzle/schema/`)

One file per domain, all re-exported from `index.ts`. Notable domains:
`core` (tenants/users/members), `crm` (contacts/companies/leads/deals),
`financial`/`billing` (invoices/quotes/subscriptions), `automation`,
`support` (tickets/SLA), `tasks`, `analytics`, `ai`, `modules`, `plugins`,
`documents`, `esignature`, `marketing`, `segments`, `security`, `compliance`,
`custom-entities`, `super-admin-audit`.

**Table conventions:** tenant-owned tables carry `tenantId`; use `deletedAt` for
soft-delete; add FKs + indexes; changes go through migrations (`db:generate` →
`db:migrate`), never `drizzle-kit push` in prod.

---

## 7. UI conventions

- **Design tokens over hardcoded colors:** `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `hover:bg-accent` (tenant/portal);
  superadmin uses its own dark `text-white/xx` scale. No raw `bg-white` /
  `text-gray-*` in themed areas (#1115).
- **Every list** renders loading + empty + error states; guard with
  `items.length === 0`; use `components/shared/empty-state.tsx`.
- **Complex widgets** are wrapped in an `ErrorBoundary`
  (`components/ui/error-boundary.tsx` / `components/shared/error-boundary.tsx`);
  lazy modules via `lib/modules/lazy-loader.tsx` are already wrapped.
- **No `any`**; type props from real data shapes (#1341).

---

## 8. Tests (`tests/`)

| Dir            | Scope                             | Command                    |
| -------------- | --------------------------------- | -------------------------- |
| `unit/`        | Pure functions / services         | `npm run test:unit`        |
| `integration/` | API routes incl. tenant isolation | `npm run test:integration` |
| `dashboard/`   | Dashboard widget logic            | (part of `test:unit`)      |
| `e2e/`         | Playwright end-to-end             | `npm run test:e2e`         |
| `load/`        | Load testing                      | see `load-test.js`         |

---

## 9. Where to look first, by task

| Task                     | Start in                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| Add a field to an entity | `drizzle/schema/<domain>.ts` → migration → the entity's route + client |
| New API endpoint         | `app/api/tenant/<area>/route.ts` (copy a sibling)                      |
| New page                 | `app/tenant/<area>/page.tsx` + `components/tenant/<area>-client.tsx`   |
| New sellable capability  | `lib/modules/registry.ts` + `lib/modules/gate.ts`                      |
| Background job           | `app/api/cron/<job>/route.ts`                                          |
| Fix an error/incident    | `error_logs` table + Sentry → the `context` string points at the route |
| Change a global rule     | `.kiro/steering/global-standards.md` (+ this hub)                      |

---

_Last reviewed: 2026-08-30. Directory listing reflects the tree at that date;
re-scan with `ls app/tenant`, `ls app/api`, `ls lib` if it looks stale._

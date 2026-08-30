# Platform Architecture

How NuCRM is put together, for operators and engineers.

> Companion: the repo-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) and the ADRs in
> [`docs/adr/`](../adr/README.md) hold additional engineering detail and decision history.

---

## System overview

NuCRM is a **multi-tenant SaaS CRM** built on **Next.js 16 (App Router)** with a **PostgreSQL**
database accessed through **Drizzle ORM**, **Redis** for caching/queues, and a set of supporting
processes.

```
                          Internet
                             │
                        ┌────▼────┐
                        │  nginx  │  (only public service)
                        └────┬────┘
             ┌───────────────┼───────────────┐
             │               │               │
        ┌────▼────┐     ┌────▼─────┐    ┌─────▼──────┐
        │  web    │     │ realtime │    │  /socket.io│ (proxied to realtime)
        │ Next.js │     │socket.io │    └────────────┘
        │ cluster │     └────┬─────┘
        └────┬────┘          │
             │        ┌──────▼──────┐
     ┌───────┼────────┤    Redis    ├───────────┐
     │       │        └─────────────┘           │
┌────▼───┐  ┌▼────────┐                    ┌─────▼────┐
│ worker │  │  cron   │                    │ PgBouncer│
│ BullMQ │  │scheduler│                    └─────┬────┘
└────┬───┘  └────┬────┘                          │
     └───────────┴──────────────────────────┌────▼─────┐
                                             │PostgreSQL│
                                             └──────────┘
```

### Processes

| Process | What it is | Where |
| --- | --- | --- |
| **web** | The Next.js app: UI pages + API routes | `next start` (PM2 cluster) |
| **worker** | Background job processor (BullMQ) | [`worker.ts`](../../worker.ts) |
| **realtime** | Standalone socket.io server for live updates | [`realtime.ts`](../../realtime.ts) |
| **cron** | Scheduler that triggers periodic jobs | `scripts/cron-scheduler.ts` (or host crontab) |

Production process definitions live in [`ecosystem.config.cjs`](../../ecosystem.config.cjs) (PM2).
See [Deployment](./deployment.md) and [Jobs & Realtime](./jobs-and-realtime.md).

---

## Application layers

```
app/            Next.js App Router
├── (marketing) Public marketing site
├── auth/       Login, signup, 2FA, SSO, invites
├── tenant/     The CRM (~149 pages) — workspace-scoped
├── superadmin/ Operator console (~31 pages)
├── portal/     Customer self-service portal
└── api/        ~492 route handlers (see API surface below)

lib/            Core libraries (auth, db, tenant, billing, ai, integrations, …)
drizzle/        Schema (~215 tables) + migrations + RLS policies
components/     UI (Radix + Tailwind)
```

### API surface (`app/api`)

| Namespace | Purpose |
| --- | --- |
| `auth/` | Login, signup, password reset, 2FA, OAuth, SSO |
| `tenant/` | All workspace-scoped CRM operations |
| `superadmin/` & `super-admin/` | Platform operator operations |
| `v1/[...path]`, `v2/[...path]` | **Versioned public API gateways** → resolve tenant, then route to `tenant/*` |
| `public/`, `embed/`, `forms/`, `track/`, `unsubscribe/` | Unauthenticated/customer-facing |
| `webhooks/` | Inbound provider webhooks (Stripe, Razorpay, PayU, Resend, WhatsApp, Telegram) |
| `cron/` | ~22 scheduled jobs (secret-authenticated) |
| `scim/v2/` | SCIM 2.0 provisioning |
| `openapi/`, `api-docs` | OpenAPI spec + Swagger UI |
| `health/`, `metrics/` | Health checks and Prometheus metrics |

The public API (`/api/v1`, `/api/v2`) is implemented as a **catch-all gateway** (`lib/api/gateway.ts`)
that authenticates, resolves the tenant (API key / `X-Tenant-ID` / custom domain), applies CORS,
and proxies to the internal `tenant/*` handlers.

---

## Multi-tenancy (defense in depth)

Tenant isolation is enforced at **two layers**:

1. **Application level** — every tenant-scoped table has a `tenant_id`, and queries filter by the
   authenticated `ctx.tenantId`. The gate is `requireAuth()` in
   [`lib/auth/middleware.ts`](../../lib/auth/middleware.ts) (for API routes) and
   `requireTenantCtx()` in [`lib/tenant/context.ts`](../../lib/tenant/context.ts) (for server
   components).
2. **Database level** — **PostgreSQL Row-Level Security (RLS)**. `setTenantContext()` in
   [`lib/db/rls.ts`](../../lib/db/rls.ts) sets the session GUCs `app.current_tenant` and
   `app.current_user`, and RLS policies restrict every row to the current tenant.

> **PgBouncer note:** PgBouncer runs in **transaction pooling** mode. Session-scoped GUCs persist on
> a pooled connection and are cleared by `DISCARD ALL` on connection reset. Request-scoped
> connection pinning keeps the tenant context and the query on the same connection. Never disable
> RLS or the isolation guards. See [Security](./security.md) and
> [`docs/TENANT-ISOLATION-VERIFICATION.md`](../TENANT-ISOLATION-VERIFICATION.md).

---

## Request lifecycle (authenticated API call)

1. Request hits **nginx**, which proxies to the `web` process.
2. The route handler calls **`requireAuth()`**: validates API key or JWT (cookie/Bearer), loads the
   user + tenant membership + role, and re-validates membership on cache hits.
3. **`setTenantContext()`** sets the Postgres GUCs so RLS applies.
4. RBAC checks (`can()`, `requirePerm()`, `requireModule()`, `requireFeature()`) authorize the
   action; mutations from cookie sessions also require a **CSRF** token.
5. The handler runs its query (RLS-scoped), returns JSON.
6. Side effects (emails, webhooks, automations) are **enqueued** and handled by the `worker`.

---

## Data & storage

- **PostgreSQL** — primary datastore, ~215 tables across ~35 Drizzle schema files in
  [`drizzle/schema`](../../drizzle). Optional **read replica** for heavy reads.
- **Redis** — cache (with in-memory fallback), BullMQ queues, socket.io adapter.
- **Object storage (S3/R2/MinIO)** — file uploads and database backups.

---

## Module & plugin architecture

- **Modules** are pluggable mini-apps that declare pages, permissions, settings, and pricing gating
  (`lib/modules`, SDK `defineModule`). Operators can enable/gate modules per plan and tenant.
- **Plugins** let a tenant call any external API with a URL + credentials, guarded against SSRF
  (`lib/plugins/engine.ts`, `lib/security/ssrf.ts`).

---

## Where to go next

- [Deployment](./deployment.md) · [Configuration](./configuration.md)
- [Security & Compliance](./security.md)
- [Jobs & Realtime](./jobs-and-realtime.md)
- ADRs: [`docs/adr/`](../adr/README.md)

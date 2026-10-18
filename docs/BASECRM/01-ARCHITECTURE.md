# 01 — Architecture

The process model, the request pipeline, and where each responsibility lives.
Read this before the data model or RBAC docs — they assume these layers.

## Stack

- **Next.js (app-router)** — one codebase serves the pages under `app/` and the
  JSON API under `app/api/**/route.ts`. The API is what a rebuild must reproduce
  faithfully; the UI is a consumer of it.
- **Drizzle ORM** over **PostgreSQL**. Schema is TypeScript
  (`drizzle/schema/*.ts`) but **row-level security is not** — it lives only in
  raw SQL migrations (`drizzle/migrations/*.sql`). Do not expect `drizzle-kit`
  to generate the policy DDL; it never did (see 02 § Migrations).
- **Multi-tenant, single-database**, isolated by FORCE RLS keyed on a
  `tenant_id` column + a per-request GUC. There is no schema-per-tenant and no
  row-hack in application code — the database is the isolation boundary.

## Layering

```
edge           request-scoped              handler (per route)
────           ───────────────             ────────────────────
proxy.ts  ──▶  requireAuth()  ──▶  withApiRoute(handler)
(JWT verify,     (session →           (pins ONE pool client
 rate buckets)   AuthContext,          for the whole handler so
                 CSRF backstop)        setTenantContext GUCs apply
                                       to every query + tx)
                                          │
                                          ▼
                                       db (Proxy) → Pool → Postgres
                                       (FORCE RLS via app.current_* GUCs)
```

### Edge gate — `proxy.ts` (Next 16; formerly `middleware.ts`)

Runs before the handler. Verifies the session JWT at the edge and applies
coarse rate buckets (`RATE_LIMIT_UNAUTH=30`, `AUTH=120`, `READS=300`,
`API_KEY=300`). It is a *first line*; it does not build the `AuthContext` and
is not the authorization authority. Every real permission check happens in the
handler via `requireAuth` + `can()` + `enforceField*`. A rebuild can keep this
thin — correctness does not depend on it, cost (rejecting unauthed junk early)
does.

### Request auth — `requireAuth()` in `lib/auth/middleware.ts:200`

The single gate a handler calls to learn *who* is making the request:

- Reads the `nucrm_session` cookie, verifies the JWT, loads the user, and loads
  the role's permissions: `COALESCE(roles.permissions,'{}'::jsonb)`
  (`lib/auth/middleware.ts:341`).
- Returns an **`AuthContext`** (`lib/auth/middleware.ts:408-411`):
  `{ tenantId, userId, roleSlug, permissions: Record<string,boolean>, isAdmin }`.
  This object is threaded into every downstream check (`can(ctx, …)`,
  `enforceFieldRead(ctx, …)`).
- **CSRF central backstop**: for cookie credentials it enforces CSRF, gated by
  env `CSRF_ENFORCE_CENTRAL` (`lib/auth/middleware.ts:220-227`). See 03 § CSRF.

### Handler wrapper — `withApiRoute()` in `lib/api/with-api-route.ts:100`

Wraps the handler body and **pins one pooled connection for the whole request**
(#1615). This is load-bearing: `setTenantContext()` sets `app.current_tenant` /
`app.current_user` on that connection, and because the wrapper guarantees every
query and `db.transaction(...)` in the handler reuses *the same* client, the GUC
is visible to all of them. Without the pin, a subsequent query could land on a
different pooled backend with no GUC set and (correctly) see zero rows. Rebuild
note: this pin is not an optimization, it is *how RLS sees the tenant*.

### Response shape

There is **no** single `{ok,data}` envelope. See 05 § Envelope for the three
coexisting shapes and the `apiError()` helper (`lib/api-error.ts:37`).

## Data access

- **Pool**: `lib/db/pool.ts:128 getPool()` → `new Pool(...)` (`:203`). A
  PgBouncer mode flag lives at `:41` (this host runs with `PGBOUNCER_ENABLED=true`
  in the preprod overlay; see 07 § Deploy).
- **Drizzle client**: `drizzle/db.ts`. `getDb()` builds
  `drizzle(getPool(), { schema })` (`:18-23`). The exported `db` is a **Proxy**
  (`:59-89`) that resolves to a per-pinned-`PoolClient` drizzle (`:38-45`) or the
  pool instance, and **intercepts `.transaction`** (`:73-84`) to re-apply
  `set_config('app.current_tenant'/'app.current_user', …, true)` from the current
  tenant carrier (PP-027). Rebuild note: keep that intercept — it is why a
  transaction started anywhere in a handler still carries the right GUCs.
- **`lib/db/client.ts`** is a thin compat shim re-exporting `getPool` plus raw
  `query` / `withTransaction` helpers.
- **Context helpers** (`lib/db/rls.ts`): `withTenantContext` (`:118`),
  `withUserContext` (`:337`), `withAuthLookupContext` (`:289`),
  `withTrackingLookupContext` (`:322`), `withSecurityContext` (`:181-189`),
  `setImpersonationContext` (`:206`). See 02/03 for what each SETs and why
  `withSecurityContext` is super-admin-scoped and must wrap the *smallest*
  possible statement set.
- **Reset on return**: GUCs are cleared on connection checkout/return
  (`lib/db/pool.ts:241`, `lib/db/request-connection.ts:93-94,241`) and PgBouncer
  runs `server_reset_query='DISCARD ALL'` (`lib/db/rls.ts:10-17`). A leaked GUC
  across tenants is prevented at *three* layers.

## Background work

- **Migrations runner**: `scripts/migrate.ts` (`npm run db:migrate`) reads the
  journal `drizzle/migrations/meta/_journal.json` and stamps the ledger
  `drizzle.__drizzle_migrations` (`scripts/migrate.ts:68,125,348-374`). See 02.
- **Cron / automations**: automation rows (`automations` table, 02) drive
  scheduled/triggered actions; a runner (pg-boss / node-cron under #401) executes
  them. Not base-CRM-critical to *rebuild* but the table shape is documented.
- **Guards** (CI hygiene, must exit 0 — see 07): `scripts/check-register-drift.mjs`,
  `scripts/check-register-coords.mjs`, `scripts/check-migration-rls-dml.mjs`,
  `scripts/check-migration-chain.mjs`, `scripts/check-migration-redeclarations.mjs`.

## Env surface (facts only; values never go in the repo)

Configured through `.env.local` / the preprod compose overlay. The base CRM
needs, at minimum: `DATABASE_URL` (see `.env.example`), session signing config,
`CSRF_ENFORCE_CENTRAL`, `TRUST_PROXY` (auth rate limiting depends on it —
`lib/client-ip.ts:14-22`), and `PGBOUNCER_ENABLED`. See 07 for the full ops list
and the DB-role/password realign that a fresh hotpatched DB requires.

## Sizing (so a rebuild budgets correctly)

Large repo: ~599 unit/integration test files (9,500+ unit tests), a 129-step
migration chain, 259 `.sql` migration files, 462 `*.test.*` files per AGENTS.md.
The *base* CRM is a small subset of tables and routes; the rest is product
surface layered on the same substrate. 06-REBUILD-GUIDE isolates the minimum set.

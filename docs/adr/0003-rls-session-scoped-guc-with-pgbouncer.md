# ADR-0003: Session-scoped tenant GUC, made safe by `DISCARD ALL`

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

`setTenantContext()` set the tenant GUC with `set_config(..., is_local => true)`,
which scopes the value to the current transaction. Every production caller passed
no transaction — 6 sites in `lib/auth/middleware.ts`, 2 in `lib/tenant/context.ts`.

A `set_config` with no surrounding transaction runs in its own implicit
single-statement transaction, so the value was discarded the moment that statement
completed — before any route query ran. Measured on PostgreSQL 16:

```
SELECT set_config('app.current_tenant','1111…',true);   -- returns 1111…
SELECT current_setting('app.current_tenant', true);     -- returns '' (empty)
SELECT current_setting('app.current_tenant')::uuid;     -- ERROR: invalid input syntax for type uuid: ""
```

So the tenant context did not leak between tenants, as issue #642 assumed. It
evaporated. And because the policy expression cast the GUC to `uuid`, an empty
value did not deny access — it raised an error and aborted the statement.

This was masked by a second bug: the application connects as the table owner, and
PostgreSQL exempts a table's owner from its own policies, so the policies were
inert anyway. Enabling `FORCE ROW LEVEL SECURITY` without fixing propagation
first would have taken the application down rather than closing a hole.

`deploy/pgbouncer/pgbouncer.ini` runs `pool_mode = transaction` and had no
`server_reset_query`.

## Decision

Three parts, which only work together:

1. When `setTenantContext()` is called **without** a transaction it uses
   `is_local => false`, so the value survives for the connection's checkout.
   With a transaction it keeps `is_local => true`.
2. PgBouncer sets `server_reset_query = DISCARD ALL`, so the GUC cannot outlive
   the checkout and reach another request.
3. Migration `0045` makes every `tenant_isolation` policy **fail closed** rather
   than fail with an error, via
   `NULLIF(current_setting('app.current_tenant', true), '')::uuid`. An empty or
   unset GUC yields `NULL`, the comparison is `NULL`, and no rows are visible.

`setTenantContext()` also rejects an empty `tenantId`/`userId` instead of writing
an empty context.

`FORCE ROW LEVEL SECURITY` remains **off**. It requires a non-owner application
role, and 28 superadmin and cron routes legitimately read across tenants.

## Consequences

- Part 2 is load-bearing. Session scope without `DISCARD ALL` is precisely the
  cross-tenant leak #642 feared. **A PgBouncer deployment without that setting is
  unsafe with this code.** It must be applied with or before the application
  deploy.
- Because the policy now denies instead of erroring, a propagation regression
  shows up as "no data" rather than a loud crash. `npm run db:verify-isolation`
  exists to make that state visible, and should be run after deploys.
- Tenant isolation still rests primarily on application-level filtering — see
  ADR-0002. This makes the database backstop _correct_, not yet _enforcing_.

## Alternatives considered

- **Wrap every request in one transaction and keep `is_local => true`.** The
  correct end state, and what `withTenantContext()` already does for the four
  call sites in `lib/notifications.ts`. Rejected for now because it means routing
  all 428 routes through a request-scoped transaction, which changes connection
  and locking behaviour everywhere at once.
- **Session scope without `DISCARD ALL`.** Rejected: reintroduces the leak.
- **Keep `is_local => true` and accept that policies are decorative.** Rejected:
  it leaves a security control that reads as if it works.
- **Enable `FORCE RLS` now.** Rejected: with the GUC empty this fails every
  tenant query, and without the role split the owner bypasses policies anyway.

# ADR-0003: Session-scoped tenant GUC, made safe by `DISCARD ALL`

- **Status:** Accepted, amended 2026-11-03 (#3404 — see the amendment at the end)
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

`deploy/pgbouncer/pgbouncer.ini` said `pool_mode = transaction` and had no
`server_reset_query` — and, as #3404 later measured, no compose service mounts that
file at all, which is how a dead path kept stating the wrong mode in this record.

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

## Amendment — 2026-11-03 (#3404): the mode became an invariant, not a description

Consequence 1 said "a PgBouncer deployment without that setting is unsafe with this
code" and left enforcement to whoever wrote the compose file. Five places described
the mode and none asserted it, and they disagreed:

| Declaration | Before #3404 | After |
| --- | --- | --- |
| `docker-compose.yml` | `POOL_MODE=transaction` + `DISCARD ALL` | `session` + `DISCARD ALL` |
| `deploy/docker-compose.preprod.yml` | `session` + `DISCARD ALL` | unchanged — the only safe one |
| `deploy/docker-compose.production.yml` | `transaction`, **no** `SERVER_RESET_QUERY` | `session` + `DISCARD ALL` |
| `deploy/pgbouncer/pgbouncer.ini` | `pool_mode = transaction`, mounted by nothing | `session`, still unmounted, asserted anyway |
| `lib/db/rls.ts` header | "PgBouncer is configured in transaction mode" | states the invariant |

Production therefore declared the leak combination — transaction pooling, where the
reset query is inert by design, so nothing cleared the GUC — and the deployment was
correct only because nothing sets `PGBOUNCER_ENABLED=true` there. That is an accident,
not a control.

`npm run guard:pool-mode` (`scripts/check-pool-mode-invariant.mjs`) is now the control:
it **parses** the YAML of every compose file rather than grepping it, requires a
declared pooler to state `session` and its reset query, forbids
`SERVER_RESET_QUERY_ALWAYS` (which would run the reset mid-session and reintroduce the
evaporation this ADR was written about), asserts the ini says the same thing, and
requires a pooler that no service routes through to be annotated with a reason and an
issue in `scripts/pool-mode-annotations.json`. Unused is allowed; unused *and silently
wrong* is not.

**Honest residual, deferred deliberately.** The guard reads declarations. Nothing yet
asks the running pooler what mode it actually booted with (`SHOW pool_mode` over the
pgbouncer admin database, refusing to serve on anything but `session`). A fail-closed
boot check on a shared box needs its own test cycle, so it is tracked as a follow-up on
#3404 rather than shipped half-verified here.

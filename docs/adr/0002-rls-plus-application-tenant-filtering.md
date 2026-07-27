# ADR-0002: RLS is a backstop, not the primary tenant filter

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Tenant isolation is enforced by hand-written `eq(table.tenantId, ctx.tenantId)`
predicates across 428 API routes. Migration `0034` intended to add a database
backstop by enabling RLS on 164 tables, but it never worked: it runs one `DO`
block, five of the listed tables cannot accept its policy (four have no
`tenant_id`; `super_admin_audit_logs.tenant_id` is `TEXT`), and the block has no
`EXCEPTION` handler. `CREATE POLICY` threw on the first such table and rolled the
whole block back, so **none** of the 164 tables ended up with RLS. Only the 12
tables from `0012` were covered.

CI provisions with `db:sync`, and the Drizzle schema files contain zero
`enableRLS`/`pgPolicy`, so RLS never existed in CI either.

## Decision

Keep application-level filtering as the primary mechanism. Treat RLS as a
defence-in-depth backstop for when a route forgets its predicate.

Migration `0043` replaces the hand-maintained table list with a `pg_catalog`
query, so the list cannot drift from the schema, and wraps each table in its own
nested block so one failure costs one table rather than all of them. It refuses
to report success if it applied zero policies.

Tenant scoping stays in the route layer, not in a repository abstraction.

## Consequences

- A route that forgets its `tenantId` predicate is still a cross-tenant bug until
  `FORCE RLS` is enabled (ADR-0003). The backstop is present and correct but not
  yet enforcing.
- Reviewers must keep checking tenant predicates on new routes. This is the main
  ongoing cost of the decision.
- `tests/unit/schema/*` assert `tenant_id` presence, type and nullability so the
  schema half cannot regress silently.

## Alternatives considered

- **RLS as the only mechanism.** Rejected: it needs a non-owner role and a
  transaction-scoped GUC on every request (ADR-0003), and 28 superadmin/cron
  routes read across tenants by design. Also makes `EXPLAIN` output and query
  plans harder to reason about.
- **Force all queries through a tenant-scoped repository layer.** Attractive and
  still open as a future refactor, but it is a rewrite of the data access in 428
  routes and does not remove the need for the database backstop.
- **Separate database or schema per tenant.** Rejected: the product is priced and
  operated for many small tenants; per-tenant migration fan-out and connection
  cost do not fit.

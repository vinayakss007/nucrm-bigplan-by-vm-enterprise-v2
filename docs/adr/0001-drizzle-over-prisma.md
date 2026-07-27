# ADR-0001: Drizzle ORM over Prisma

- **Status:** Accepted
- **Date:** 2026-07-27 (recorded retrospectively)

## Context

Recorded after the fact — the decision predates this ADR process, and the
reasoning was only inferable from the code. Written down now because several
later decisions depend on it.

The application is a multi-tenant CRM where every query must be tenant-scoped,
row-level security is a design goal (ADR-0002, ADR-0003), and the schema is large
(~220 tables).

## Decision

Use Drizzle ORM with `drizzle-orm/node-postgres` over a `pg` `Pool`.

The properties the rest of the architecture relies on:

- **Raw SQL is a first-class citizen.** The `sql` template is used directly for
  `set_config`, advisory locks, catalogue queries and the RLS verification
  scripts. None of that needs an escape hatch.
- **The schema is TypeScript, introspectable at runtime.** `getTableConfig()` is
  what lets `tests/unit/schema/*` assert `tenant_id` presence, column types and
  `ON DELETE` semantics with no database. That test strategy (ADR-0010) is not
  available with a DSL-based schema.
- **No query engine binary or generation step**, so `tsx scripts/*.ts` runs
  against production shapes without a build.
- **Explicit connection ownership.** `lib/db/pool.ts` owns the `pg` `Pool`
  directly, which is what makes PgBouncer transaction mode, `statement_timeout`,
  graceful pool drain (`lib/db/graceful-shutdown.ts`) and the circuit breaker
  (`lib/db/safe-connection.ts`) implementable.

## Consequences

- Less guardrail than Prisma. A missing `.where(eq(table.tenantId, ...))` is
  valid Drizzle, which is exactly the exposure ADR-0002 exists to backstop.
- `.set()` accepts a `Record<string, any>` and silently ignores keys that are not
  columns. This caused a real bug: the deals `PATCH` handler spread snake_case
  request keys into `.set()`, so `contact_id`, `company_id`, `close_date`,
  `assigned_to` and `pipeline_id` never persisted. Always map request fields to
  columns explicitly.
- Migration tooling is thinner. `drizzle-kit`'s snapshot output is what produced
  the unrunnable chain in ADR-0008, and drizzle's `migrate()` has no rollback
  concept, which is why `lib/db/rollback.ts` had to be written.
- Type inference on deeply nested relational queries is weaker than Prisma's.

## Alternatives considered

- **Prisma.** Stronger guardrails and better nested-read ergonomics, but the
  generated client and its own connection handling sit awkwardly with PgBouncer
  transaction mode and per-request `set_config`, and the schema is not
  introspectable as TypeScript at runtime.
- **TypeORM.** Rejected: decorator/entity model and weaker TypeScript inference.
- **Raw `pg` with hand-written SQL.** Maximum control, rejected for the
  maintenance cost of ~220 tables with no typed schema.

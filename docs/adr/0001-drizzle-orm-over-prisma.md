# ADR-0001: Drizzle ORM over Prisma

## Status

Accepted

## Context

NuCRM is a multi-tenant CRM with approximately 220 tables. Every query must be
tenant-scoped, row-level security is a design goal, and the schema must be
introspectable at runtime for automated testing. The ORM choice affects connection
management, migration tooling, and how tenant isolation is enforced at the query
level.

## Decision

Use Drizzle ORM (`drizzle-orm/node-postgres`) over a raw `pg` Pool.

Key properties the architecture depends on:

- Raw SQL is first-class via the `sql` template tag, used for `set_config`,
  advisory locks, and RLS verification scripts without escape hatches.
- The schema is TypeScript and introspectable at runtime (`getTableConfig()`),
  enabling unit tests that assert `tenant_id` presence and column types with no
  database connection.
- No query engine binary or generation step, so `tsx scripts/*.ts` runs against
  production shapes without a build.
- Explicit connection ownership via `lib/db/pool.ts`, enabling PgBouncer
  transaction mode, `statement_timeout`, graceful pool drain, and circuit breaker
  patterns.

## Consequences

- Less guardrail than Prisma: a missing `.where(eq(table.tenantId, ...))` is
  valid Drizzle, which is why RLS exists as a backstop.
- Migration tooling is thinner; `drizzle-kit` has no rollback concept, requiring
  a custom `lib/db/rollback.ts`.
- Type inference on deeply nested relational queries is weaker than Prisma's.
- Manual tenant filtering required on every query rather than middleware-based.

## Alternatives Considered

- **Prisma**: Stronger guardrails and better nested-read ergonomics, but the
  generated client and its own connection handling conflict with PgBouncer
  transaction mode and per-request `set_config`. Schema not introspectable as
  TypeScript at runtime.
- **TypeORM**: Decorator/entity model with weaker TypeScript inference. Rejected
  for poor type safety and maintenance burden.
- **Raw pg with hand-written SQL**: Maximum control, rejected for maintenance
  cost across 220+ tables with no typed schema.

# Architecture Decision Records

An ADR records a decision that was expensive to reach, so the next person does not
pay for it again -- and, more importantly, so nobody reverses it without knowing
what it cost.

Write one when a decision is hard to infer from the code. If the code already makes
the reasoning obvious, skip it.

## Index

| ADR                                                   | Decision                                                          | Status   |
| ----------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| [0001](0001-drizzle-orm-over-prisma.md)               | Drizzle ORM over Prisma/TypeORM                                   | Accepted |
| [0001](0001-drizzle-over-prisma.md)                   | Drizzle ORM over Prisma (detailed)                                | Accepted |
| [0002](0002-socket-io-redis-realtime.md)              | Socket.io with Redis for realtime over Pusher/Ably                | Accepted |
| [0002](0002-rls-plus-application-tenant-filtering.md) | RLS as a backstop, not the primary tenant filter                  | Accepted |
| [0003](0003-edge-rate-limiting.md)                    | In-memory edge rate limiting over Redis-only                      | Accepted |
| [0003](0003-rls-session-scoped-guc-with-pgbouncer.md) | Session-scoped tenant GUC + `DISCARD ALL`                         | Accepted |
| [0004](0004-bullmq-job-queue.md)                      | BullMQ over pg-boss for job queue                                 | Accepted |
| [0004](0004-hybrid-record-linking.md)                 | FK columns for domain-core, `record_links` for the rest           | Accepted |
| [0005](0005-managed-postgresql.md)                    | Managed PostgreSQL (Neon/RDS) over self-hosted                    | Accepted |
| [0005](0005-not-valid-foreign-keys.md)                | Add foreign keys as `NOT VALID`                                   | Accepted |
| [0006](0006-api-error-as-the-single-error-path.md)    | `apiError()` is the single API error path                         | Accepted |
| [0007](0007-backup-status-stays-completed.md)         | Backup status stays `completed` when only the off-site copy fails | Accepted |
| [0008](0008-migration-chain-baseline.md)              | Squash the migration chain to a baseline                          | Proposed |
| [0009](0009-sdk-envelope-unwrapping.md)               | Unwrap API envelopes per SDK method, not centrally                | Proposed |
| [0010](0010-line-coverage-is-not-the-goal.md)         | Line coverage is not the quality target                           | Accepted |

## Template

Copy [`template.md`](template.md). Keep it short -- an ADR that takes 20 minutes to
read will not be read.

## Process

- Add an ADR in the same PR as the change it describes.
- Never edit an accepted ADR to say something different. Supersede it with a new
  one and mark the old one `Superseded by ADR-NNNN`. The wrong turns are the
  valuable part.
- Status is one of `Proposed`, `Accepted`, `Superseded by ADR-NNNN`, `Deprecated`.

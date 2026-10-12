# Architecture Decision Records

An ADR records a decision that was expensive to reach, so the next person does not
pay for it again -- and, more importantly, so nobody reverses it without knowing
what it cost.

Write one when a decision is hard to infer from the code. If the code already makes
the reasoning obvious, skip it.

## Index

| ADR                                                   | Decision                                                          | Status   |
| ----------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| [0001](0001-drizzle-over-prisma.md)                   | Drizzle ORM over Prisma (detailed)                                | Accepted |
| [0001](0001-drizzle-orm-over-prisma.md)               | Drizzle ORM over Prisma/TypeORM                                   | Accepted |
| [0002](0002-rls-plus-application-tenant-filtering.md) | RLS as a backstop, not the primary tenant filter                  | Accepted |
| [0002](0002-socket-io-redis-realtime.md)              | Socket.io with Redis for realtime over Pusher/Ably                | Accepted |
| [0003](0003-rls-session-scoped-guc-with-pgbouncer.md) | Session-scoped tenant GUC + `DISCARD ALL`                         | Accepted |
| [0003](0003-edge-rate-limiting.md)                    | In-memory edge rate limiting over Redis-only                      | Accepted |
| [0004](0004-hybrid-record-linking.md)                 | FK columns for domain-core, `record_links` for the rest           | Accepted |
| [0004](0004-bullmq-job-queue.md)                      | BullMQ over pg-boss for job queue                                 | Accepted |
| [0005](0005-not-valid-foreign-keys.md)                | Add foreign keys as `NOT VALID`                                   | Accepted |
| [0005](0005-managed-postgresql.md)                    | Managed PostgreSQL (Neon/RDS) over self-hosted                    | Accepted |
| [0006](0006-api-error-as-the-single-error-path.md)    | `apiError()` is the single API error path                         | Accepted |
| [0006](0006-email-sync-architecture.md)               | Two-way email sync architecture                                   | Accepted |
| [0007](0007-backup-status-stays-completed.md)         | Backup status stays `completed` when only the off-site copy fails | Accepted |
| [0008](0008-migration-chain-baseline.md)              | Squash the migration chain to a baseline                          | Proposed |
| [0009](0009-sdk-envelope-unwrapping.md)               | Unwrap API envelopes per SDK method, not centrally                | Proposed |
| [0010](0010-line-coverage-is-not-the-goal.md)         | Line coverage is not the quality target                           | Accepted |
| [0011](0011-realtime-socketio-redis.md)               | Realtime via socket.io + Redis in a separate service              | Accepted |
| [0012](0012-audit-log-immutability.md)                | Enforce audit-log immutability in the database                    | Accepted |

## Numbering collisions (as of 2026-10-04)

Six numbers are each occupied by two files. This is provable, and it is not going to
be silently repaired:

```bash
ls docs/adr/ | sed -E 's/^([0-9]{4}).*/\1/' | sort | uniq -c | awk '$1 > 1'
#      2 0001   2 0002   2 0003   2 0004   2 0005   2 0006
```

Two generations of ADRs were numbered independently and merged into one directory:

- **Current template** — `- **Status:** Accepted` under the title: `0001-drizzle-over-prisma`,
  `0002-rls-plus-application-tenant-filtering`, `0003-rls-session-scoped-guc-with-pgbouncer`,
  `0004-hybrid-record-linking`, `0005-not-valid-foreign-keys`,
  `0006-api-error-as-the-single-error-path`, 0007–0012.
- **Older style** — a `## Status` heading: `0001-drizzle-orm-over-prisma`,
  `0002-socket-io-redis-realtime`, `0003-edge-rate-limiting`, `0004-bullmq-job-queue`,
  `0005-managed-postgresql`, `0006-email-sync-architecture`.

What can be said about each pair, from the files themselves:

- **0001** is one decision recorded twice (`0001-drizzle-over-prisma` is the detailed one). Both stay.
- **0002** overlaps **ADR-0011** (`0011-realtime-socketio-redis`), which is the later record of the same
  socket.io + Redis choice. ADR-0011 should be read first.
- **0003**, **0004**, **0005**, **0006** are _different decisions sharing a number_, not duplicates:
  rate limiting vs the tenant GUC, BullMQ vs record linking, managed PostgreSQL vs `NOT VALID` FKs,
  `apiError()` vs email sync. Each pair stands on its own merits.
- Whether the older six still describe today's system is **not asserted here.** Some are clearly still
  live — `bullmq@6.3.8` and `ioredis@5.11.1` are direct dependencies. Others are worth re-reading before
  citing: `socket.io` and `@neondatabase/serverless` are absent from `package.json` dependencies, and
  `lib/rate-limit.ts` speaks of Redis. Verify against the code before quoting any of them as current.

**Rule for new ADRs:** take the next free number after the highest existing one (**0013 onward**), and
never reuse a number involved in a collision above. Re-renumbering the existing files would break every
reference to them in git history and in the issue register, which is worse than the collision.

## Template

Copy [`template.md`](template.md). Keep it short -- an ADR that takes 20 minutes to
read will not be read.

## Process

- Add an ADR in the same PR as the change it describes.
- Never edit an accepted ADR to say something different. Supersede it with a new
  one and mark the old one `Superseded by ADR-NNNN`. The wrong turns are the
  valuable part.
- Status is one of `Proposed`, `Accepted`, `Superseded by ADR-NNNN`, `Deprecated`.

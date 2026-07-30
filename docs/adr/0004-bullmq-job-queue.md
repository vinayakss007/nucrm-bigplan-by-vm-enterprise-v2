# ADR-0004: BullMQ for Job Queue

## Status

Accepted

## Context

NuCRM needs background job processing for email sending, webhook delivery,
report generation, and data import/export. The system already uses Redis and
requires priority queues, dead letter queues, concurrency control, and job
scheduling with cron-like semantics.

## Decision

Use BullMQ as the job queue system, backed by the existing Redis instance.

Key properties:

- Reuses existing Redis infrastructure with no additional database.
- Native support for priority queues, delayed jobs, repeatable jobs, and
  rate-limited processing.
- Dead letter queue (DLQ) support for failed jobs with configurable retry
  strategies.
- Per-queue concurrency control prevents resource exhaustion.
- Job progress tracking and event-driven architecture for monitoring.

## Consequences

- Redis becomes a more critical dependency: queue data loss on Redis failure
  without persistence enabled.
- BullMQ stores job payloads in Redis, so large payloads increase memory usage.
  Must store references (S3 keys, database IDs) rather than full data.
- Worker scaling requires careful concurrency tuning per queue to avoid
  overwhelming downstream services.
- No built-in multi-tenant job isolation; tenant fairness must be implemented
  via named queues or priority scheduling.

## Alternatives Considered

- **pg-boss**: Uses PostgreSQL for job storage, removing Redis dependency for
  queues. Rejected because it adds write load to the primary database, lacks
  BullMQ's priority queue sophistication, and we already have Redis available.
- **RabbitMQ**: Full-featured message broker with better delivery guarantees.
  Rejected for operational complexity of running another stateful service when
  Redis already covers the use case.
- **AWS SQS + Lambda**: Fully managed, infinite scale. Rejected for vendor
  lock-in and inability to run locally without emulators.

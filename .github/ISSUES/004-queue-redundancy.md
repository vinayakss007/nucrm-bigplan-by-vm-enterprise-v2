# Queue Redundancy: BullMQ and pg-boss both installed (Issue #401)

During our architecture review, we found that both `bullmq` and `pg-boss` are installed as dependencies in `package.json` and are likely both being used or initialized in the codebase.

## Issue Details
- `bullmq` relies on Redis for queue management.
- `pg-boss` uses PostgreSQL for queue management.

Having two separate queuing systems introduces operational complexity, increases infrastructure requirements (mandating both Redis and Postgres for background jobs), and creates confusion around which system to use for new background jobs or workflows.

## Recommendation
We recommend consolidating to a single background job/queue backend.
- If Redis is already a hard dependency for caching/sessions and high-throughput background processing is required, standardize entirely on `bullmq` and remove `pg-boss`.
- If minimizing infrastructure dependencies is preferred (i.e. relying solely on PostgreSQL), standardize on `pg-boss` and remove `bullmq`.

Once a decision is made, the unused library should be uninstalled, its initialization code removed, and all jobs migrated to the chosen queue system.

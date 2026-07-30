# ADR-0005: Managed PostgreSQL (Neon) over Self-Hosted

## Status

Accepted

## Context

NuCRM requires PostgreSQL for its relational data with row-level security,
complex queries, and JSONB support. The team must decide between self-hosted
PostgreSQL (on EC2/Kubernetes) and a managed service. The system targets
variable workloads with development environments that need database branching.

## Decision

Use Neon (serverless managed PostgreSQL) as the primary database provider, with
AWS RDS as the documented alternative for teams preferring traditional managed
PostgreSQL.

Key properties:

- Serverless auto-scaling: compute scales to zero during inactivity and scales
  up under load without manual intervention.
- Database branching for development: each developer or CI run gets an instant
  copy-on-write branch of production schema and seed data.
- Connection pooling built in via Neon's proxy, complementing PgBouncer at the
  application layer.
- Point-in-time recovery and automated backups with no operational burden.

## Consequences

- Vendor dependency on Neon for the primary data store. Mitigation: standard
  PostgreSQL wire protocol means migration to RDS or self-hosted is a
  connection string change.
- Cold start latency when scaling from zero (approximately 500ms for first
  query after idle period). Acceptable for dev/staging; production keeps
  minimum compute active.
- Neon's branching model requires understanding copy-on-write semantics for
  storage billing.
- Some PostgreSQL extensions may not be available compared to self-hosted.

## Alternatives Considered

- **Self-hosted PostgreSQL (EC2/Kubernetes)**: Maximum control over
  configuration and extensions. Rejected for operational burden: patching,
  backup management, failover configuration, and scaling require dedicated
  DBA effort the team does not have.
- **AWS RDS**: Traditional managed PostgreSQL with predictable pricing and
  broad extension support. Documented as alternative; not primary choice due
  to lack of serverless scaling and database branching.
- **PlanetScale/CockroachDB**: Distributed SQL databases. Rejected because
  NuCRM's workload does not require global distribution, and these lack full
  PostgreSQL compatibility needed for RLS and extensions.

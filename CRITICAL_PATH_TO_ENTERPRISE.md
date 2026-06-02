# Critical Path to Enterprise Scale

This doc captures every infrastructure gap that must be addressed before NuCRM
can reliably serve thousands of tenants at enterprise scale. Ordered by priority.

---

## PHASE 0: OBSERVABILITY FOUNDATION (prerequisite for everything else)
You cannot fix what you cannot see. Build this first.

### 0.1 Centralized Log Aggregation
- Install Loki + Promtail (or sign up for Axiom/Datadog)
- Ship all logs (app, worker, nginx, postgres, redis) to a single sink
- Add structured fields: requestId, tenantId, userId, duration, status
- Configure log retention: 30d hot, 90d warm, 1y cold

### 0.2 Custom Prometheus Metrics
Export metrics from every app instance:
- `http_requests_total{method,path,status,tenant}`
- `http_request_duration_seconds{method,path}`
- `db_query_duration_seconds{operation,table}`
- `db_query_count_total{operation,table}`
- `db_pool_size`, `db_pool_available`, `db_pool_waiting`
- `cache_hit_count`, `cache_miss_count`, `cache_size`
- `queue_job_count{queue,status}`, `queue_job_duration_seconds{queue}`
- `active_connections`, `active_sse_connections`
- `worker_count`, `worker_busy`

### 0.3 Slow Query Logging
- Enable `log_min_duration_statement = 200` in PostgreSQL
- Ship slow queries to the log aggregator
- Build a dashboard: top-N slow queries over time, by tenant

### 0.4 Business Metrics (Track These)
- Tenants created/hr, activated/hr, churned/hr
- Contacts created/hr, deals created/hr, tasks completed/hr
- API requests/min by tenant (top-N)
- Error rate by endpoint, by tenant
- P99 response time by endpoint

### 0.5 Alerting Rules
Alert on:
- Error rate > 1% over 5min
- P95 response time > 2s
- DB pool exhaustion (available < 2)
- Any worker queue depth > 1000
- Cache hit rate < 70%
- Backup failure
- SSL cert expiry < 14 days

---

## PHASE 1: INFRASTRUCTURE RESILIENCE

### 1.1 CI/CD Pipeline
- `.github/workflows/ci.yml`: lint → typecheck → unit tests → build
- `.github/workflows/deploy.yml`: on main merge, run integration tests → build → deploy
- Branch protection on main: CI must pass, require PR review
- Docker image build + push to registry (GHCR or ECR)
- Zero-downtime deploy: rolling update via Docker Swarm or K8s

### 1.2 Database Topology
- **Read replicas**: minimum 1 replica, route read queries there
- **Connection pooling**: use PgBouncer in transaction mode, pool of 50-100
- **Table partitioning**: partition by `tenant_id` hash for large tables (contacts, deals, activities, audit_logs)
- **Failover**: configure Patroni or RDS Multi-AZ for automatic failover. Test it quarterly.

### 1.3 Rate Limiting Middleware
Convert the existing `lib/rate-limit.ts` into a global Next.js middleware:
- Wrap ALL `/api/*` routes
- Apply per-tenant + per-user + per-IP limits simultaneously
- Tiered limits based on plan (free=60/min, pro=300/min, enterprise=unlimited)
- Return standardized `X-RateLimit-*` headers on every response
- Bypass for internal health checks and webhooks

### 1.4 Feature Flags (Runtime)
Build a lightweight flag system (or use Unleash/LaunchDarkly):
- Store flags in Redis (not DB — must be fast)
- Admin UI to toggle flags
- Support: percentage rollout, tenant-ID targeting, user-ID targeting
- Kill switch: instant disable of any feature without deploy
- Cache flags with 30s TTL, refresh on read

---

## PHASE 2: DATA RESILIENCE & SCALE

### 2.1 Point-in-Time Recovery
- Enable PostgreSQL WAL archiving to S3
- Configure pgBackRest or WAL-G for continuous archiving
- RPO: < 5 minutes. RTO: < 30 minutes.
- Test full restore monthly (automated)

### 2.2 Geo-Redundant Backups
- Backups to S3 in primary region + replicate to secondary region
- 3-2-1 rule: 3 copies, 2 media types, 1 offsite
- Backup encryption with KMS
- Monitor backup success/failure with alerting

### 2.3 Audit Log Hardening
- Ship audit logs to append-only storage (AWS S3 Object Lock or similar)
- WORM policy: no deletion for 7 years (SOC2/HIPAA)
- Maintain SHA-256 hash chain in the DB for fast queries
- Real-time alerting: bulk export, role escalation, mass delete

### 2.4 Multi-Tenant Job Isolation
- Per-tenant queues in BullMQ: `{tenantId}:send-email`, `{tenantId}:webhooks`
- Queue-level concurrency limits per tenant
- Global pool cap: all tenants combined cannot starve the system
- Job prioritization: password-reset > notification > campaign

### 2.5 Asynchronous Bulk Operations
All current bulk endpoints are synchronous (risk: timeout).
- POST to create bulk job → return `jobId`
- Worker processes job, writes to `{entity}_import_results`
- GET `/api/tenant/bulk/{jobId}` returns status + progress + errors
- Webhook notification on completion

---

## PHASE 3: ARCHITECTURE MODERNIZATION

### 3.1 Real-Time Infrastructure
- Replace SSE polling with WebSocket (via `pusher.js` or `socket.io`)
- Redis Pub/Sub for cross-instance event broadcasting
- Use for: notifications, presence, collaborative editing, live activity feed
- Connection scaling: use a dedicated WebSocket server or managed service (Pusher, Ably)

### 3.2 Zero-Downtime Migrations
- Use `pgroll` or `pt-online-schema-change` for schema changes
- Never run `db:push` in production — remove the npm script
- Every migration must have a dry-run step in CI
- Write rollback scripts for every migration
- Validate rollback in CI

### 3.3 Cache Stampede Protection
- Add mutex/lock around `getOrSet` in `lib/cache/`
- Use Redis `SET NX` for distributed mutex with 500ms TTL
- Background refresh: stale-while-revalidate pattern
- Cache warming on deploy: pre-load hot keys

### 3.4 API Version Lifecycle
- Define formal policy: vN supported for 12mo after vN+1 ships
- Add `Sunset` and `Deprecation` headers to responses
- Build API changelog page
- Gate v3 planning behind feature flag

---

## PHASE 4: DEVELOPER EXPERIENCE

### 4.1 Test Infrastructure Overhaul
- Remove all exclusions from `vitest.config.ts`. All tests must run in CI.
- Raise coverage thresholds to 80% for new code.
- Write integration tests for every API route.
- Load tests in CI: run k6 against preview deployment.
- Disaster recovery test: restore from backup, run smoke tests.

### 4.2 Self-Service Data Portability
- API endpoint: `GET /api/tenant/export` returns a job ID
- Async export job: JSON and CSV formats
- API endpoint: `POST /api/tenant/import/{entity}` accepts CSV
- Progress tracking on both
- Data portal UI in settings page

### 4.3 Runbooks & Documentation
- Write runbooks for: DB failover, cache failure, queue backpressure, tenant corruption
- ADR process: document every architecture decision with context, options, tradeoffs
- Hosted API docs: deploy Swagger UI or Stoplight
- Developer onboarding guide: setup → first PR → deploy

---

## QUICK WINS (do this week)

1. Remove `db:push` npm script
2. Add slow query logging to postgresql.conf
3. Add requestId to logger (use `crypto.randomUUID()`)
4. Raise vitest coverage thresholds from 50% → 70%
5. Remove test exclusions from vitest config
6. Add global rate limiting middleware
7. Add Prometheus metrics exporter endpoint
8. Configure Loki + Promtail for log shipping
9. Add PgBouncer to docker-compose
10. Add health check for worker process

---

## INFRASTRUCTURE DECISIONS

Every choice below has tradeoffs. These are recommendations based on a
single-region, multi-tenant PostgreSQL SaaS running ~100-1000 tenants.

| Concern | Recommended | Alternative |
|---------|-------------|-------------|
| Log aggregation | Loki + Grafana | Axiom, Datadog, ELK |
| Metrics | Prometheus + Grafana | Datadog, New Relic |
| Error tracking | Sentry (exists) | — |
| Feature flags | Unleash (self-host) | LaunchDarkly |
| Real-time | Pusher (managed) | socket.io + Redis |
| Queue | BullMQ (exists) | — |
| DB proxy | PgBouncer | pgcat, Odyssey |
| Migrations | pgroll | gh-ost, pt-online |
| CI/CD | GitHub Actions | GitLab CI, CircleCI |
| Containers | Docker Compose → K8s | ECS, Nomad |

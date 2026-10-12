# NuCRM Architecture Overview

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Load Balancer (nginx)                        │
│                    TLS Termination + Rate Limiting                  │
└─────────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│   Next.js     │      │   Next.js     │      │   Next.js     │
│   App Server  │      │   App Server  │      │   App Server  │
│   (Port 3000) │      │   (Port 3000) │      │   (Port 3000) │
└───────┬───────┘      └───────┬───────┘      └───────┬───────┘
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               ▼
                    ┌───────────────────────┐
                    │   PgBouncer (6432)    │
                    │  Session Pooling Mode │
                    └───────────┬───────────┘
                                ▼
                    ┌───────────────────────┐
                    │  UpCloud PostgreSQL   │
                    │   (Managed, TLS)      │
                    └───────────────────────┘
```

## Core Components

### 1. Next.js Application (App Router)
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript (strict mode)
- **Rendering**: Server Components by default, Client Components where needed
- **Authentication**: JWT-based with HttpOnly cookies + CSRF protection
- **State Management**: React Server Components + Server Actions

### 2. Database Layer
- **ORM**: Drizzle ORM (type-safe SQL)
- **Database**: PostgreSQL 16 (UpCloud Managed)
- **Connection Pooling**: PgBouncer (session pooling mode)
- **Multi-tenancy**: Row Level Security (RLS) on all tenant tables
- **Migrations**: 93 migrations (versioned, reversible)

### 3. Caching & Sessions
- **Redis**: Caching, rate limiting, BullMQ queues, session store
- **Session**: JWT in HttpOnly cookies + Redis-backed session store
- **Cache Invalidation**: Tag-based with `cache.delByPattern()`

### 4. Background Processing
- **BullMQ**: Email sending, webhook delivery, automation engine
- **Cron Jobs**: Backup, usage snapshots, lead warming, sequence processing
- **Workers**: Separate worker process for queue processing

### 5. Real-time
- **Socket.io**: Real-time notifications, live updates
- **Separate process**: Port 4001

---

## Data Model Overview

### Core Entities
```
Tenant (workspace) ──┬── Users (members)
                     ├── Contacts
                     ├── Leads
                     ├── Deals
                     ├── Companies
                     ├── Tasks
                     ├── Meetings
                     ├── Activities
                     ├── Pipelines/Stages
                     ├── Custom Fields
                     └── Automations
```

### Key Design Decisions
1. **RLS-first**: Every tenant table has `tenant_id` + RLS policy
2. **Soft deletes**: `deleted_at` timestamp, never hard delete
3. **Audit trail**: `created_at`, `updated_at`, `created_by`, `deleted_by`
3. **Extensibility**: JSONB `metadata` + `custom_fields` on all entities
4. **Optimistic locking**: `updated_at` for concurrency control

---

## API Design

### Conventions
- **Naming**: snake_case for all JSON keys (request/response)
- **Pagination**: `limit` (default 50, max 200) + `offset`
- **Filtering**: `q` for search, specific fields for exact match
- **Sorting**: `sort_by` + `sort_order` (asc/desc)
- **Errors**: Standardized envelope `{ error: string, code?: string }`

### Authentication
```
POST /api/auth/signup          # Self-serve workspace creation
POST /api/auth/login           # Email/password
POST /api/auth/logout          # Session destruction
POST /api/auth/forgot-password # Password reset request
POST /api/auth/reset-password  # Password reset with token
GET  /api/auth/csrf-token      # CSRF token for forms
```

### Tenant-scoped Resources
```
GET    /api/tenant/contacts
POST   /api/tenant/contacts
GET    /api/tenant/contacts/:id
PATCH  /api/tenant/contacts/:id
DELETE /api/tenant/contacts/:id

GET    /api/tenant/leads
POST   /api/tenant/leads
...

GET    /api/tenant/deals
POST   /api/tenant/deals
...

GET    /api/tenant/tasks
POST   /api/tenant/tasks
...

GET    /api/tenant/meetings
POST   /api/tenant/meetings
...

GET    /api/tenant/companies
POST   /api/tenant/companies
...
```

### Search & Analytics
```
GET /api/tenant/search?q=term&limit=20
GET /api/tenant/analytics/overview
GET /api/tenant/analytics/stats
GET /api/tenant/dashboard/stats
GET /api/tenant/dashboard/widgets/*
```

### Webhooks
```
POST /api/tenant/webhooks              # Register webhook
GET  /api/tenant/webhooks              # List webhooks
POST /api/tenant/webhooks/:id/test     # Test webhook
GET  /api/tenant/webhooks/:id/deliveries  # Delivery history
```

---

## Authentication & Authorization

### JWT Structure
```typescript
interface JWTPayload {
  userId: string;
  tenantId?: string;
  isSuperAdmin: boolean;
  iat: number;
  exp: number;
}
```

### Session Management
- Access token: 15 min (JWT in HttpOnly cookie)
- Refresh token: 30 days (rotating, stored in DB)
- CSRF: Double-submit cookie pattern
- TRUST_PROXY: Required for rate limiting behind nginx

### RBAC Model
```
Super Admin (platform) ─────────────────────────────► All tenants, all actions
    │
    └── Tenant Admin ────────────────────────────────► Own tenant, all actions
            │
            ├── Sales Rep ──────────────────────────► Own + assigned records
            ├── Member ─────────────────────────────► Own records only
            └── Viewer ─────────────────────────────► Read only
```

### Permission Keys
```
contacts: read, write, delete, import, export, assign
leads:    read, write, delete, convert, assign
deals:    read, write, delete, close, assign
tasks:    read, write, delete, assign
meetings: read, write, delete
companies: read, write, delete
settings: read, write
reports:  read, export
admin:    users, roles, billing, integrations, webhooks
```

---

## Background Jobs

### Queue Structure
```
Queue: send-email          # Transactional emails
Queue: send-notification   # In-app notifications
Queue: send-bulk-emails    # Marketing campaigns
Queue: run-automation      # Workflow execution
Queue: send-lead-warming   # Drip campaigns
Queue: webhooks            # Webhook delivery
Queue: run-sequences       # Sequence steps
Queue: process-sequences   # Sequence processing
```

### Cron Schedule
| Schedule | Job | Purpose |
|----------|-----|---------|
| `*/5 * * * *` | process-sequences | Execute due sequence steps |
| `*/10 * * * *` | retry-webhooks | Retry failed webhooks |
| `*/30 * * * *` | detect-missed-followups | Create follow-up tasks |
| `0 * * * *` | task-reminders | Send task reminders |
| `0 0 * * *` | trial-check | Check trial expirations |
| `0 0 * * 0` | usage-snapshot | Weekly usage snapshot |
| `0 2 * * *` | auto-backup | Daily backups |
| `0 3 * * 0` | backup-health | Backup monitoring |
| `0 4 * * *` | backup-verify | Verify backup integrity |
| `0 4 * * 0` | cleanup | Remove expired data |
| `0 5 * * *` | subscription-check | Billing checks |
| `0 7 * * *` | contract-renewal-check | Contract alerts |
| `0 8 * * *` | process-at-risk | At-risk deal alerts |
| `0 9,13,17 * * *` | warmup-emails | Email warmup |
| `0 8 * * *` | ai-auto-followup | AI follow-up generation |

---

## Deployment Architecture

### Docker Compose (Production)
```
Services:
├── nginx              # Reverse proxy, TLS, rate limiting
├── app                # Next.js app (3 replicas)
├── worker             # BullMQ workers
├── realtime           # Socket.io server
├── cron               # Cron job runner
├── pgbouncer          # Connection pooler
├── redis              # Cache + queues
├── postgres-exporter  # Prometheus metrics
├── redis-exporter     # Prometheus metrics
├── node-exporter      # Host metrics
├── prometheus         # Metrics collection
├── alertmanager       # Alert routing
├── grafana            # Dashboards
├── loki               # Log aggregation
├── promtail           # Log shipping
├── minio              # S3-compatible storage
└── certbot            # Let's Encrypt SSL
```

### Network
- Internal network: `nucrm-net`
- Published ports: 80, 443 (nginx), 3100 (Loki)
- Internal only: 3000 (app), 4001 (realtime), 5432 (pgbouncer), 6379 (redis)

---

## Security Implementation

### RLS Policies (93 tables)
- All tenant tables: `tenant_id = current_setting('app.current_tenant')`
- Super admin bypass: `current_setting('app.is_super_admin') = 'true'`
- Self-read: `id = current_setting('app.current_user')`
- Cross-tenant: Blocked by default

### Connection Pinning (#1615)
- `withPinnedConnection()` wraps request handlers
- Single PgBouncer connection per request
- Tenant GUC persists across all queries in request
- Automatic cleanup on scope exit

### Rate Limiting
- Edge: nginx `limit_req_zone` (60r/s API, 5r/s auth, 20r/s public)
- Application: Redis-backed sliding window per action
- Per-IP and per-email limits on auth endpoints

---

## Monitoring Stack

### Metrics (Prometheus)
- **Application**: Request latency, error rate, active requests
- **Database**: Active connections, query latency, pool utilization
- **Redis**: Memory, connected clients, hit rate, queue depths
- **System**: CPU, memory, disk, network

### Key Dashboards (Grafana)
- **API Overview**: Latency p50/p95/p99, error rate, throughput
- **Database**: Connection pool, query latency, slow queries
- **Queue Health**: Job throughput, failure rate, retry rate
- **Business**: Signups, workspace creation, lead conversion

### Alerting Rules
| Alert | Condition | Severity |
|-------|-----------|----------|
| HighErrorRate | error_rate > 1% for 5m | critical |
| HighLatency | p95_latency > 2s for 5m | warning |
| DBPoolExhausted | pool_usage > 90% | critical |
| QueueBacklog | queue_depth > 1000 | warning |
| DiskSpace | disk_usage > 85% | warning |
| BackupFailed | backup_status = failed | critical |

---

## Disaster Recovery

### Backup Strategy
- **Frequency**: Daily at 02:00 UTC
- **Retention**: 90 days
- **Storage**: MinIO (S3-compatible) + offsite replication
- **Verification**: Daily integrity check + monthly test restore

### RTO/RPO Targets
| Scenario | RTO | RPO |
|----------|-----|-----|
| Database failure | 15 min | 24 hours |
| App server failure | 5 min | 0 |
| Redis failure | 5 min | 0 |
| Region outage | 60 min | 24 hours |

### Recovery Procedures
See `docs/RUNBOOKS.md` for detailed procedures.
# NuCRM — Capacity Planning & Resource Calculator

> **How much server do I need?** From 1 user to 1 million.

---

## Quick Answer Table

| Users | Tenants | Contacts (total) | VM Spec | Monthly Cost |
|-------|---------|-------------------|---------|--------------|
| 1–5 | 1 | <10K | 2 vCPU / 4 GB / 40 GB SSD | ~$10–20 |
| 5–50 | 1–5 | 10K–100K | 4 vCPU / 8 GB / 80 GB SSD | ~$25–50 |
| 50–200 | 5–20 | 100K–500K | 4 vCPU / 16 GB / 160 GB SSD | ~$50–100 |
| 200–1,000 | 20–100 | 500K–2M | 8 vCPU / 32 GB / 320 GB SSD | ~$100–200 |
| 1,000–5,000 | 100–500 | 2M–10M | 16 vCPU / 64 GB / 500 GB SSD | ~$200–400 |
| 5,000–20,000 | 500–2,000 | 10M–50M | Multi-node cluster | ~$500–1,500 |
| 20,000–100,000 | 2,000+ | 50M–200M | Multi-node + read replicas | ~$1,500–5,000 |
| 100,000–1,000,000 | 10,000+ | 200M+ | Full distributed architecture | ~$5,000–20,000+ |

---

## Resource Breakdown Per Component

### 1. Application Server (Next.js)

| Metric | Per Instance | Formula |
|--------|-------------|---------|
| RAM (idle) | 180 MB | Fixed baseline |
| RAM (per concurrent user) | +2–5 MB | Heap for SSR + API handling |
| CPU (idle) | 0.05 cores | Event loop baseline |
| CPU (per request) | 0.001–0.01 cores | Average 10–50ms per API call |
| Recommended concurrency | 50–100 users/instance | Before response time degrades |

**Scaling formula:**
```
instances_needed = ceil(concurrent_users / 75)
ram_per_instance = 180MB + (concurrent_users_per_instance × 3MB)
```

| Concurrent Users | App Instances | RAM Total |
|-----------------|---------------|-----------|
| 1–10 | 1 | 256 MB |
| 10–50 | 1 | 512 MB |
| 50–150 | 2 | 1 GB |
| 150–500 | 4 | 2 GB |
| 500–2,000 | 8 | 4 GB |
| 2,000–10,000 | 16–20 | 8–10 GB |

---

### 2. PostgreSQL Database

| Metric | Formula |
|--------|---------|
| RAM (shared_buffers) | 25% of total RAM |
| RAM (effective_cache_size) | 75% of total RAM |
| Connections | 5 per app instance + 5 overhead |
| Disk per 1M rows | ~200–500 MB (depends on columns) |
| Disk per 1M contacts | ~400 MB (with indexes) |
| Disk per 1M activities | ~600 MB (with metadata JSONB) |

**Storage growth estimate:**
```
storage_gb = (contacts × 0.4KB + deals × 0.6KB + activities × 0.8KB + 
              tasks × 0.3KB + emails × 1.5KB + documents × avg_file_size) / 1GB
              + (indexes ≈ 30% of data) + (WAL ≈ 2GB buffer)
```

| Total Records | DB Size | RAM Needed | Connections |
|---------------|---------|-----------|-------------|
| <100K | <1 GB | 1 GB | 20 |
| 100K–1M | 1–5 GB | 2 GB | 30 |
| 1M–10M | 5–20 GB | 4 GB | 50 |
| 10M–50M | 20–80 GB | 8 GB | 80 |
| 50M–200M | 80–300 GB | 16 GB | 100+ |
| 200M+ | 300 GB+ | 32 GB+ | Read replicas |

---

### 3. Redis (Cache + Queues)

| Usage | RAM Needed |
|-------|-----------|
| Cache only (sessions + app cache) | 64–256 MB |
| Cache + BullMQ queues (light) | 256–512 MB |
| Cache + heavy queues (bulk email 10K+) | 512 MB–1 GB |
| High-traffic (10K+ concurrent) | 1–2 GB |

**Key counts estimate:**
```
keys = sessions(active_users) + cache(tenants × 50) + queue_jobs(pending)
memory = keys × avg_value_size (typically 1–5KB per key)
```

---

### 4. Object Storage (S3/MinIO)

| Content | Size Per Item | Growth |
|---------|--------------|--------|
| Database backups | 50–500 MB/day | Retained 30 days |
| Document uploads | 1–10 MB average | Per user activity |
| Email attachments | 500 KB average | Per email sent |

**Storage formula:**
```
storage_gb = (daily_backup_mb × 30 / 1024) + 
             (documents × avg_doc_mb / 1024) +
             (email_attachments × avg_attach_mb / 1024)
```

| Activity Level | Monthly Storage Growth |
|---------------|----------------------|
| 1–5 users, light | ~500 MB/month |
| 50 users, moderate | ~5 GB/month |
| 200 users, heavy | ~20 GB/month |
| 1,000 users, enterprise | ~100 GB/month |

---

### 5. Network / Bandwidth

| Traffic Type | Size |
|-------------|------|
| Page load (SSR) | 200–500 KB |
| API call (JSON) | 1–50 KB |
| File upload | 1–100 MB |
| File download | 1–100 MB |
| WebSocket/SSE (real-time) | 1–5 KB/event |

**Monthly bandwidth:**
```
bandwidth_gb = (page_views × 0.3MB + api_calls × 0.01MB + 
               file_transfers × avg_file_mb) / 1024
```

| Users | Monthly Bandwidth |
|-------|------------------|
| 1–10 | <5 GB |
| 50 | ~20 GB |
| 200 | ~80 GB |
| 1,000 | ~400 GB |
| 10,000 | ~4 TB |

---

## Scaling Tiers (Detailed)

### Tier 1: Solo / Startup (1–5 users)

```
┌────────────────────────────────────────┐
│  Single VM: 2 vCPU / 4 GB / 40 GB     │
│                                        │
│  ┌──────┐ ┌──────┐ ┌──────┐          │
│  │ App  │ │ PG   │ │Redis │          │
│  │256MB │ │1 GB  │ │128MB │          │
│  └──────┘ └──────┘ └──────┘          │
│  + Worker + Cron = ~512 MB             │
│  OS + overhead = ~1 GB                 │
│  Total: ~3 GB of 4 GB                 │
└────────────────────────────────────────┘
```

**Config:**
```env
NUCRM_WEB_REPLICAS=1
NUCRM_WEB_MEMORY_LIMIT=384M
NUCRM_WORKER_REPLICAS=1
DATABASE_POOL_SIZE=10
REDIS_MAXMEMORY=128mb
```

---

### Tier 2: Small Team (5–50 users) ⭐ YOUR 8 GB VM

```
┌────────────────────────────────────────┐
│  Single VM: 4 vCPU / 8 GB / 80 GB     │
│                                        │
│  ┌────────────┐ ┌──────────┐          │
│  │ App ×2     │ │ Postgres │          │
│  │ 768MB each │ │ 1.5 GB   │          │
│  └────────────┘ └──────────┘          │
│  ┌──────┐ ┌──────┐ ┌──────┐          │
│  │Worker│ │Redis │ │MinIO │          │
│  │512MB │ │512MB │ │512MB │          │
│  └──────┘ └──────┘ └──────┘          │
│  + Monitoring (Prometheus+Grafana) 512M│
│  + Nginx + Cron + Exporters = 256 MB   │
│  + OS overhead = ~1.2 GB               │
│  Total: ~6.5 GB of 8 GB              │
└────────────────────────────────────────┘
```

**Config (deploy/.env.production defaults):**
```env
NUCRM_WEB_REPLICAS=2
NUCRM_WEB_MEMORY_LIMIT=768M
NUCRM_WORKER_REPLICAS=1
NUCRM_WORKER_MEMORY_LIMIT=512M
DATABASE_POOL_SIZE=20
REDIS_MAXMEMORY=512mb
```

**Handles:**
- 50 concurrent users comfortably
- 100K contacts
- 500K total records
- 50 GB storage

---

### Tier 3: Growing Business (50–200 users)

```
┌────────────────────────────────────────┐
│  Single VM: 4–8 vCPU / 16 GB / 160 GB │
│                                        │
│  App ×3 (1 GB each) = 3 GB            │
│  Worker ×2 = 1.5 GB                   │
│  Postgres = 4 GB                       │
│  Redis = 1 GB                          │
│  MinIO = 1 GB                          │
│  Monitoring = 1 GB                     │
│  OS + nginx = 2 GB                     │
│  Total: ~13.5 GB of 16 GB            │
└────────────────────────────────────────┘
```

**Config:**
```env
NUCRM_WEB_REPLICAS=3
NUCRM_WEB_MEMORY_LIMIT=1024M
NUCRM_WORKER_REPLICAS=2
NUCRM_WORKER_MEMORY_LIMIT=768M
DATABASE_POOL_SIZE=40
REDIS_MAXMEMORY=1024mb
```

---

### Tier 4: Enterprise (200–1,000 users)

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  App Server  │  │  DB Server   │  │  Cache/Queue │
│  8 vCPU/16GB │  │  8 vCPU/32GB │  │  4 vCPU/8GB  │
│              │  │              │  │              │
│  App ×6      │  │  PostgreSQL  │  │  Redis 4GB   │
│  Worker ×3   │  │  28GB RAM    │  │  MinIO       │
│  Nginx       │  │  500GB SSD   │  │              │
│  Monitoring  │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
         3 separate VMs (or managed services)
```

**Config:**
```env
NUCRM_WEB_REPLICAS=6
NUCRM_WEB_MEMORY_LIMIT=1536M
NUCRM_WORKER_REPLICAS=3
DATABASE_POOL_SIZE=60
REDIS_MAXMEMORY=4096mb
# Use managed PostgreSQL (RDS/Supabase) at this scale
# Use managed Redis (ElastiCache/Upstash) at this scale
```

---

### Tier 5: Large Scale (1,000–10,000 users)

At this point, move to managed services:

| Component | Managed Service | Spec |
|-----------|----------------|------|
| App | Kubernetes / ECS | 10–20 pods |
| Database | AWS RDS / Supabase Pro | db.r6g.xlarge (32GB) |
| Cache | ElastiCache / Upstash | 8–16 GB cluster |
| Storage | S3 (real AWS) | Unlimited |
| CDN | CloudFront / Cloudflare | Edge caching |
| Email | Resend Pro | 50K+/month |
| Monitoring | Datadog / Grafana Cloud | Full APM |

---

### Tier 6: Massive Scale (10,000–1,000,000 users)

| Component | Architecture |
|-----------|-------------|
| App | Kubernetes HPA, 50–200 pods |
| Database | PostgreSQL cluster with read replicas (Citus / AlloyDB) |
| Cache | Redis Cluster (6+ nodes) |
| Queue | Dedicated BullMQ workers, possibly move to SQS |
| Storage | S3 + CloudFront CDN |
| Search | Add ElasticSearch for full-text search |
| Real-time | Dedicated WebSocket server (Socket.io / Ably) |
| AI | Dedicated GPU instances or Bedrock/Vertex |

---

## Optimization Strategies

### Level 1: Configuration Tuning (free, do first)

| Optimization | Where | Impact |
|-------------|-------|--------|
| Increase DB pool size | `DATABASE_POOL_SIZE` | Reduces connection wait time |
| Tune PostgreSQL for your RAM | `deploy/postgres/postgresql.conf` | 2–5x query performance |
| Set Redis maxmemory correctly | `REDIS_MAXMEMORY` | Prevents OOM crashes |
| Enable gzip in nginx | Already enabled | 60–80% smaller responses |
| Set correct `NODE_OPTIONS` | `--max-old-space-size=1024` | Prevents JS heap OOM |

### Level 2: Caching (high impact, low effort)

| What to cache | TTL | Impact |
|--------------|-----|--------|
| Tenant settings | 5 min | Eliminates ~40% of DB reads |
| User permissions/roles | 2 min | Auth check without DB |
| Module registry | 10 min | Eliminates per-request module check |
| Plan limits | 5 min | Usage enforcement without DB |
| Static API responses | 30 sec | Reduces DB load on list endpoints |

### Level 3: Database Optimization (medium effort)

| Optimization | When | How |
|-------------|------|-----|
| Add missing indexes | >50K rows per table | Check `EXPLAIN ANALYZE` on slow queries |
| Partition large tables | >10M rows | Partition `activities` by month |
| Archive old data | >50M rows | Move records older than 1 year to archive table |
| Connection pooling (PgBouncer) | >50 connections | Add PgBouncer between app and Postgres |
| Read replicas | >100 concurrent users | Route SELECT queries to replica |
| Vacuum tuning | Always | Ensure autovacuum runs frequently |

### Level 4: Application Optimization (high effort)

| Optimization | When | Impact |
|-------------|------|--------|
| Static page generation (ISR) | Dashboard, settings | Reduces server load 50% |
| API response pagination | Always | Prevents large payload transfers |
| Lazy-load heavy modules | Module-gated features | Reduces initial bundle |
| WebSocket for real-time | >50 concurrent users | Replaces polling |
| Background job batching | Bulk operations | Reduces queue pressure |
| CDN for static assets | Any traffic level | Offloads bandwidth from server |

---

## Monitoring Thresholds — When to Scale

| Metric | "Consider scaling" | "Scale NOW" |
|--------|-------------------|-------------|
| CPU (sustained) | >60% for 5 min | >80% for 2 min |
| Memory | >75% | >88% |
| DB connections | >70% of max | >85% of max |
| Response time P95 | >500ms | >2000ms |
| Error rate | >0.5% | >2% |
| Disk I/O wait | >20% | >40% |
| Queue depth (BullMQ) | >100 pending jobs | >1000 pending |
| Redis memory | >75% of maxmemory | >90% |

---

## Cost Optimization Tips

1. **Start small, scale up** — Don't over-provision. A $20/month VM handles 50 users fine.
2. **Use managed DB last** — Self-hosted PostgreSQL is free; only switch to RDS when you need HA.
3. **MinIO before S3** — Free self-hosted storage until you need multi-region.
4. **Resend free tier** — 3,000 emails/month free covers most startups.
5. **Sentry free tier** — 5,000 errors/month free is plenty for small teams.
6. **Cloudflare free CDN** — Put it in front of nginx for free DDoS protection + caching.
7. **Use spot/preemptible instances** — For workers (they auto-restart on eviction).

---

## Disk Space Calculator

```
Total disk needed (GB) =
  OS + Docker images ........... 10 GB (fixed)
  PostgreSQL data .............. (total_records × 0.5KB) / 1M × GB
  PostgreSQL WAL ............... 2 GB (fixed buffer)
  Redis persistence ............ REDIS_MAXMEMORY × 2 (RDB + AOF)
  MinIO (backups) .............. daily_backup_size × 30 days
  MinIO (documents) ............ user_uploads (variable)
  Docker logs .................. 2–5 GB (rotate weekly)
  Prometheus metrics (30d) ..... 1–5 GB
  Headroom (20%) ............... total × 0.2
```

**Example for your 8 GB VM setup (50 users, 100K records):**
```
OS + Docker:    10 GB
PostgreSQL:      2 GB (100K × 0.5KB + indexes)
WAL:             2 GB
Redis RDB:       1 GB
MinIO backups:   3 GB (100MB/day × 30)
MinIO docs:      5 GB
Logs:            2 GB
Prometheus:      2 GB
Headroom:        5 GB
─────────────────────
TOTAL:          32 GB → 40 GB SSD minimum, 80 GB recommended
```

---

## Summary: Your 8 GB VM Can Handle

| Metric | Comfortable | Maximum (before degradation) |
|--------|-------------|------------------------------|
| Concurrent users | 50 | 100 |
| Tenants | 5–10 | 20 |
| Total contacts | 200K | 500K |
| Total records (all tables) | 1M | 2M |
| File storage | 50 GB | 70 GB (with 80 GB disk) |
| API requests/sec | 50 | 150 |
| Background jobs/min | 100 | 500 |
| Email sends/hour | 200 | 1,000 (Resend limit) |

**When you outgrow this:** Upgrade to 16 GB VM ($40–60/month) → then split DB to its own server → then add managed services as needed.

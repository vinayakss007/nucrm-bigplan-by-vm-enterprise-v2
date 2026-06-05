# NuCRM Scaling Strategy

This document defines the vertical and horizontal scaling architecture for NuCRM. The system is designed so the app NEVER becomes heavy on its own — tenants only load features they use, and infrastructure scales independently based on demand.

---

## 1. Vertical Scaling — Feature Gating (Keep App Lightweight)

### Problem
A CRM with 50+ modules would ship megabytes of JS to every user, even if they only use Contacts + Deals. This kills load time and wastes bandwidth.

### Solution: Module-Gated Lazy Loading

```
Tenant enables module → Client checks gate → next/dynamic loads JS → Feature renders
Tenant does NOT have module → Zero bytes loaded → Nothing rendered
```

### Architecture

| Layer | File | Purpose |
|-------|------|---------|
| Server Gate | `lib/modules/gate.ts` | API-level enforcement (403 if module disabled) |
| Client Context | `lib/modules/client-gate.tsx` | React context with tenant's active modules |
| Lazy Loader | `lib/modules/lazy-loader.tsx` | `next/dynamic` + gate = code-split per module |
| Registry | `lib/modules/registry.ts` | All available modules + plan-based pricing |
| API | `app/api/tenant/modules/route.ts` | Enable/disable/configure modules |

### How to Add a New Feature Module

1. **Register it** in `lib/modules/registry.ts` (BUILTIN_MODULES array)
2. **Gate the API** in your route: `const blocked = await requireModule(tenantId, 'my-module'); if (blocked) return blocked;`
3. **Lazy-load the UI**: 
   ```tsx
   // In lib/modules/lazy-loader.tsx
   export const LazyMyFeature = lazyModule('my-module', () => import('@/components/tenant/my-feature'));
   ```
4. **Gate in sidebar** (already done — sidebar reads from module context)
5. **Use in page**: `<LazyMyFeature />` — renders nothing if disabled, loads JS only if enabled

### Bundle Impact

| Scenario | JS Loaded |
|----------|-----------|
| Free plan (core only) | ~180KB gzipped |
| Pro plan (all modules) | ~180KB + lazy chunks on demand |
| Enterprise (everything) | Same initial load, heavy features load on navigate |

The initial bundle is ALWAYS the same size. Heavy features are separate chunks loaded on demand.

---

## 2. Horizontal Scaling — Multi-Instance Frontend

### Problem
Single Next.js instance can handle ~500 concurrent users. Beyond that, responses slow down.

### Solution: Multiple Frontend Instances + Load Balancer

```
Internet → nginx (LB) → web-1:3000
                       → web-2:3000
                       → web-3:3000
                       → web-N:3000
         → worker-1 (BullMQ)
         → worker-2 (BullMQ)
```

### Deployment Options

#### Option A: PM2 Cluster (Single Server, Multi-Core)
```bash
# Uses all CPU cores on one machine
pm2 start ecosystem.config.js
pm2 scale web 4        # 4 instances
pm2 scale web +2       # Add 2 more
pm2 reload web         # Zero-downtime deploy
```

**When to use:** Single VPS/dedicated server with 4+ cores. Cheapest option.

#### Option B: Docker Compose (Single Server, Isolated)
```bash
# Run with N web replicas
docker compose -f docker-compose.scale.yml up -d --scale web=4
```

**When to use:** Need container isolation, reproducible deploys, or CI/CD integration.

#### Option C: Multi-VM with PM2 Deploy
```bash
# Deploy to multiple servers simultaneously
pm2 deploy production setup    # First time
pm2 deploy production          # Subsequent deploys
```

Configure hosts in `ecosystem.config.js` → `deploy.production.host` array.

**When to use:** Need geographic distribution or extreme redundancy.

#### Option D: Kubernetes (Future)
Not included yet. When you need auto-scaling beyond 10 VMs, add Helm charts.

---

## 3. Load Balancing Strategy

### nginx Configuration (`infra/nginx/nginx.conf`)

| Setting | Value | Why |
|---------|-------|-----|
| Algorithm | `least_conn` | Routes to instance with fewest active connections |
| Keepalive | 32 connections | Reuse TCP connections to upstream |
| Health check | Every 15s | Remove unhealthy instances automatically |
| Rate limit (API) | 60 req/s per IP | Prevent single client from overwhelming |
| Rate limit (Auth) | 5 req/s per IP | Brute-force protection |
| Static cache | 1 year immutable | `_next/static` never re-fetched |
| Gzip | Level 4 | Balance compression ratio vs CPU |
| Client max body | 50MB | File uploads |

### Sticky Sessions: NOT Required
NuCRM is stateless at the frontend level:
- Sessions stored in JWT (cookie) — any instance can verify
- Cache is in Redis (shared) — not in-process
- No WebSocket state — can add Redis pub/sub later if needed

---

## 4. When to Scale

### Monitoring Signals

| Metric | Threshold | Action |
|--------|-----------|--------|
| CPU per instance > 70% sustained | 5 min | Add instance |
| Memory per instance > 450MB | Sustained | Add instance or increase limit |
| Response time P95 > 500ms | 5 min | Add instance |
| Error rate > 1% | 1 min | Check health, maybe add instance |
| Request queue depth > 50 | Instant | Add instance |
| Active connections per instance > 200 | Sustained | Add instance |

### Scaling Playbook

```bash
# 1. Check current state
pm2 status          # or: docker compose ps

# 2. Scale up
pm2 scale web +2    # or: docker compose up --scale web=4 -d

# 3. Verify
curl http://localhost/api/health

# 4. Scale down (off-peak)
pm2 scale web 2     # or: docker compose up --scale web=2 -d
```

---

## 5. Resource Limits (Prevent Any Single Tenant from Killing the Server)

### Per-Process Limits (ecosystem.config.js)
- Web: 512MB max per instance → auto-restart if exceeded
- Worker: 768MB max per instance
- Cron: 256MB max (single instance only)

### Per-Tenant Limits (Application Level)
- Rate limit: 60 API req/min (configurable per plan)
- Bulk operations: 5 req/hour
- CSV import: max 10,000 rows
- File upload: max 50MB per file
- Concurrent connections: 50 per IP

### Docker Resource Limits (docker-compose.scale.yml)
- Web: 512MB memory, 1 CPU per container
- Worker: 768MB memory, 1 CPU per container
- PostgreSQL: 1GB memory, 2 CPUs
- Redis: 512MB memory, 256MB maxmemory with LRU eviction

---

## 6. Shared State (What's NOT Per-Instance)

All instances share these — they are NOT duplicated:

| Service | Where | Purpose |
|---------|-------|---------|
| PostgreSQL | Single instance (or RDS) | All data |
| Redis | Single instance (or ElastiCache) | Cache, sessions, rate limits, queues |
| BullMQ queues | In Redis | Job distribution across workers |
| File storage | S3/R2 | Uploads, backups, exports |

### What IS Per-Instance (Ephemeral)
- In-process LRU cache (500 entries max) — warm-up takes <1s
- Active HTTP connections
- Event loop / memory

---

## 7. Zero-Downtime Deploys

### PM2
```bash
pm2 reload web    # Rolling restart — old instances serve until new ones are ready
```

### Docker
```bash
docker compose -f docker-compose.scale.yml up -d --no-deps --build web
# nginx health check removes old containers, routes to new ones
```

### Process:
1. Build new image/version
2. Start new instances (health check must pass)
3. nginx routes traffic to new instances
4. Old instances drain (kill_timeout: 10s)
5. Old instances removed

---

## 8. Cost Estimation

| Setup | Monthly Cost | Handles |
|-------|-------------|---------|
| 1 VPS + PM2 (4 cores) | $20-40 | ~2,000 concurrent users |
| 2 VPS + PM2 + LB | $60-100 | ~5,000 concurrent users |
| Docker Compose (8 web) | $80-150 | ~8,000 concurrent users |
| 4 VMs + managed DB + Redis | $200-400 | ~20,000 concurrent users |

All costs assume standard cloud providers (Hetzner, DigitalOcean, AWS).

---

## 9. File Reference

| File | Purpose |
|------|---------|
| `ecosystem.config.js` | PM2 process management config |
| `docker-compose.scale.yml` | Multi-container Docker setup |
| `infra/nginx/nginx.conf` | Load balancer configuration |
| `Dockerfile` | Container build (already exists) |
| `lib/modules/client-gate.tsx` | Client-side module context + hooks |
| `lib/modules/lazy-loader.tsx` | Dynamic import with module gate |
| `lib/modules/gate.ts` | Server-side module enforcement |
| `lib/modules/registry.ts` | Module definitions + install/disable |
| `app/api/tenant/modules/route.ts` | Module management API |

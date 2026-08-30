# Installation & Deployment

How to stand up NuCRM for local development, and how it runs in production.

> Companion: the repo-root [`DEPLOYMENT.md`](../../DEPLOYMENT.md) has the long-form deployment guide;
> `deploy/` holds infra configs (nginx, pgbouncer, postgres, monitoring). This page is the operator
> orientation.

---

## Prerequisites

- **Node.js ≥ 22**, **npm ≥ 10** (see `engines` in `package.json`)
- **PostgreSQL 15+**
- **Redis** (for queues, cache, realtime) — recommended in all environments, required for
  multi-process/production
- Optional but recommended in production: **PgBouncer**, S3-compatible object storage, an email
  provider

---

## Local development

```bash
# 1. Clone and install
git clone https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git
cd nucrm-bigplan-by-vm-enterprise-v2
npm install

# 2. Configure environment
cp .env.example .env.local
#   Set at minimum: DATABASE_URL, JWT_SECRET, SESSION_SECRET, SETUP_KEY, CRON_SECRET
#   (generate secrets with the commands noted in .env.example)

# 3. Create the schema and seed sample data
npm run db:migrate
npm run seed:dev

# 4. Run the app
npm run dev            # app at http://localhost:3000
# For background jobs + worker together:
npm run dev:all        # runs web + worker
```

Bootstrap the first admin + workspace:

```bash
curl -X POST http://localhost:3000/api/setup/create-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"AdminPass123!","full_name":"Admin","workspace_name":"Acme"}'
```

> See [Configuration Reference](./configuration.md) for every environment variable.

---

## Docker Compose (full local stack)

[`docker-compose.yml`](../../docker-compose.yml) brings up the whole platform, including a
**monitoring** profile.

| Service | Role |
| --- | --- |
| `web` | Next.js app |
| `worker` | BullMQ background worker |
| `realtime` | socket.io realtime server |
| `postgres` | PostgreSQL 16 |
| `pgbouncer` | Connection pooler (transaction mode) |
| `minio` / `minio-setup` | S3-compatible object storage (files + backups) |
| `redis` | Cache / queues / socket.io adapter |
| **Monitoring profile** | `prometheus`, `grafana`, `loki`, `promtail`, `alertmanager`, `node-exporter`, `redis-exporter`, `postgres-exporter` |

```bash
docker compose up -d                      # core services
docker compose --profile monitoring up -d # + observability stack
```

A `docker-compose.scale.yml` variant exists for scaled setups.

---

## Production

Production is designed around **nginx as the only public service**, fronting app processes managed
by **PM2** (see [`ecosystem.config.cjs`](../../ecosystem.config.cjs)).

### Process model (PM2)

| PM2 app | Mode | Default instances | Notes |
| --- | --- | --- | --- |
| `web` | cluster | `max` | `next start`, bound to `127.0.0.1` (nginx proxies to it) |
| `worker` | cluster | `2` | Runs `worker.ts`; 30s kill timeout for in-flight jobs |
| `cron` | fork | `1` | Runs the scheduler — **exactly one** to avoid duplicate scheduling |

```bash
pm2 start ecosystem.config.cjs         # start all
pm2 start ecosystem.config.cjs --only web
pm2 scale web 4                        # scale frontend
pm2 reload ecosystem.config.cjs        # zero-downtime reload
pm2 logs / pm2 monit
```

Tunables (env): `NUCRM_INSTANCES`, `NUCRM_HOST`, `NUCRM_PORT`, `NUCRM_MAX_MEMORY`,
`NUCRM_WORKER_INSTANCES`, `NUCRM_LOG_DIR`.

### nginx

[`nginx.conf`](../../nginx.conf) is the public edge. It terminates TLS, proxies HTTP to
`web` (`127.0.0.1:3000`), and proxies **`/socket.io/`** to the `realtime` process. Keep app ports
off the public interface.

### Container image

[`Dockerfile`](../../Dockerfile) is a multi-stage build producing a slim runtime image. `.dockerignore`
keeps the context lean. Vercel deployment config is in `vercel.json`.

### Cron scheduling — pick ONE source

Run **either** the PM2 `cron` app **or** a host crontab (`deploy/cron/`) — never both, to avoid
double execution. Cron endpoints are authenticated with `CRON_SECRET` (and optionally IP
allowlisting / HMAC signing). See [Jobs & Realtime](./jobs-and-realtime.md).

---

## Database lifecycle

| Command | Purpose |
| --- | --- |
| `npm run db:migrate` | Apply pending migrations (canonical) |
| `npm run db:status` | Show migration status |
| `npm run db:generate` | Generate a new migration |
| `npm run db:rollback` | Roll back the last migration |
| `npm run db:verify-chain` | Verify the migration chain integrity |
| `npm run db:drift-check` | Detect schema drift |
| `npm run db:verify-isolation` | Verify tenant isolation (RLS) |
| `npm run db:verify-integrity` | Verify data integrity |

> Use `db:migrate` in all environments. `db:sync` (drizzle push) is guarded and intended only for
> CI/throwaway databases. Migration recovery is covered in
> [`docs/runbooks/migration-drift-recovery.md`](../runbooks/migration-drift-recovery.md).

---

## Pre-flight & launch

| Command | Purpose |
| --- | --- |
| `npm run preflight` | Pre-flight checks |
| `npm run prod:preflight` | Production diagnostics |
| `npm run launch-gate` | Launch gate checks |
| `npm run smoke` | Smoke test |

Follow the [go-live runbook](../runbooks/go-live.md) and the
[Production Readiness](../PRODUCTION-READINESS.md) checklist before launch.

---

## Related

- [Configuration Reference](./configuration.md)
- [Monitoring & Observability](./monitoring.md)
- [Backups & Disaster Recovery](./backups-dr.md)
- [Operations Runbooks](./runbooks.md)

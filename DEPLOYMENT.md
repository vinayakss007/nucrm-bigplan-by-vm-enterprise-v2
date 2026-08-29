# NuCRM — Deployment Guide

Production deployment on a single VM (8 GB RAM recommended).

## Prerequisites

| Service | Minimum                    | Recommended  |
| ------- | -------------------------- | ------------ |
| VM RAM  | 4 GB                       | 8 GB         |
| CPU     | 2 vCPU                     | 4 vCPU       |
| Disk    | 40 GB SSD                  | 80 GB SSD    |
| OS      | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 |
| Docker  | 24+                        | Latest       |

### External Services Required

| Service                   | Purpose             | Where to get                         |
| ------------------------- | ------------------- | ------------------------------------ |
| **Domain + DNS**          | Public URL          | Any registrar                        |
| **Email (Resend)**        | Transactional email | [resend.com](https://resend.com)     |
| **Sentry**                | Error tracking      | [sentry.io](https://sentry.io)       |
| **LLM API key**           | AI features         | OpenAI / Anthropic / Groq            |
| Stripe _(optional)_       | Billing             | [stripe.com](https://stripe.com)     |
| Telegram Bot _(optional)_ | Admin alerts        | [@BotFather](https://t.me/BotFather) |

## Quick Start (5 minutes)

```bash
# 1. Clone the repo
git clone https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git
cd nucrm-bigplan-by-vm-enterprise-v2

# 2. Generate secrets
bash deploy/generate-secrets.sh > /tmp/secrets.txt
cat /tmp/secrets.txt  # Copy values into .env

# 3. Create .env from template
cp deploy/.env.production .env
nano .env  # Fill in ALL <<<REQUIRED>>> values

# 4. Generate self-signed SSL (replace with Let's Encrypt for production)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout deploy/nginx/ssl/privkey.pem \
  -out deploy/nginx/ssl/fullchain.pem \
  -subj "/CN=crm.yourdomain.com"

# 5. Deploy!
bash deploy/scripts/deploy.sh
```

## What Gets Deployed

```
┌─────────────────────────────────────────────────────────┐
│  VM (8 GB RAM)                                          │
│                                                         │
│  ┌─────────┐    ┌──────────────────────────────────┐   │
│  │  nginx   │───▶│  app (Next.js) x2 replicas       │   │
│  │  :80/443 │    └──────────────────────────────────┘   │
│  └─────────┘    ┌──────────────────────────────────┐   │
│                  │  worker (BullMQ background jobs)  │   │
│                  └──────────────────────────────────┘   │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │ Postgres │   │  Redis   │   │  MinIO   │           │
│  │  :5432   │   │  :6379   │   │ (S3)     │           │
│  └──────────┘   └──────────┘   └──────────┘           │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │Prometheus│   │ Grafana  │   │  Cron    │           │
│  │  :9090   │   │  :3001   │   │ scheduler│           │
│  └──────────┘   └──────────┘   └──────────┘           │
└─────────────────────────────────────────────────────────┘
```

## Environment Variables Overview

| Section    | Variables                                                     | Notes                          |
| ---------- | ------------------------------------------------------------- | ------------------------------ |
| Core       | `NEXT_PUBLIC_APP_URL`, `ALLOWED_ORIGINS`                      | Your public domain             |
| Auth       | `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `SETUP_KEY` | Generated secrets              |
| Database   | `DATABASE_URL`, `POSTGRES_PASSWORD`                           | Auto-configured in Docker      |
| Redis      | `REDIS_URL`                                                   | `redis://redis:6379` in Docker |
| Storage    | `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID/SECRET`                     | MinIO or external S3           |
| Email      | `RESEND_API_KEY`                                              | From resend.com dashboard      |
| AI         | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`                       | At least one required          |
| Sentry     | `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`                  | From sentry.io                 |
| Monitoring | `GRAFANA_ADMIN_PASSWORD`                                      | For Grafana login              |
| Billing    | `STRIPE_SECRET_KEY` _(optional)_                              | For paid plans                 |

See `deploy/.env.production` for the full documented template.

## Database TLS (required in production)

The app connects to Postgres over TLS in production. Plaintext DB traffic
(`sslmode=disable`) exposes credentials and customer PII to any in-network
attacker and fails SOC 2 / GDPR, so it is refused at startup.

- `DATABASE_URL` must use `?sslmode=require` (or `?sslmode=verify-full` with a
  CA) and `DATABASE_SSL=true`. The `deploy/.env.production` template already
  ships this default; keep the two consistent.
- `prod:preflight` (`npm run prod:preflight`) refuses to run when
  `DATABASE_URL` contains `sslmode=disable` while `NODE_ENV=production`.
- **Certificate verification:** in production the app verifies the server
  certificate (`rejectUnauthorized: true`, see `lib/db/ssl-config.ts`). For
  `sslmode=require` with a self-signed server cert the connection is encrypted
  but the CA is not trusted, so set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` (the
  explicit escape hatch). For full verification, use `sslmode=verify-full` and
  install a CA / Let's Encrypt cert the client trusts (system trust store or the
  connection's `sslrootcert`), leaving `DATABASE_SSL_REJECT_UNAUTHORIZED` unset.
- **Supplying the cert:** generate the DB server cert with
  `deploy/postgres/generate-server-cert.sh`; see `deploy/POSTGRES_PRODUCTION_GUIDE.md`
  for the full procedure. Verify with:

  ```bash
  psql "host=<host> dbname=nucrm user=nucrm sslmode=require" -c 'SHOW ssl;'  # → on
  ```

## Tenant isolation (RLS) — enforced in the default deploy (#1615)

Tenant isolation is enforced by PostgreSQL Row-Level Security (RLS). Each request
sets the `app.current_tenant` / `app.current_user` session GUCs via
`setTenantContext()`, and the fail-closed `tenant_isolation` policy
(migration `0039_rls_fail_closed_policy`) returns **zero rows** when the GUC is
empty.

- **Now enforced out of the box in the DEFAULT deploy.** The default deploy runs
  the app under **pm2** against a plain `node-postgres` pool (NOT PgBouncer,
  `PGBOUNCER_ENABLED` unset). Previously RLS was effectively non-functional on
  that path: `setTenantContext()` set the GUC on one pooled connection that was
  released immediately, and each subsequent `db` query checked out a _different_
  connection whose GUC was empty, so the fail-closed policy denied every row and
  RLS provided no real defense-in-depth. As of #1615 the app pins **one**
  PoolClient per request (`lib/db/request-connection.ts` + the `db` proxy in
  `drizzle/db.ts`) so the tenant GUC and the request's data queries run on the
  **same** connection. RLS tenant isolation now works without PgBouncer.
- **The pin does NOT serialize the pool.** It checks out a single connection for
  the request and releases it at request end; concurrent requests still use
  separate connections up to `DATABASE_POOL_SIZE`.
- **On release, the tenant GUCs are reset** (in `withPinnedConnection`'s finally
  block and by the pool's `release` handler in `lib/db/pool.ts`) so no stale
  context can leak to the next checkout.
- **PgBouncer is still SUPPORTED and compatible, but NO LONGER REQUIRED for RLS
  correctness.** When `PGBOUNCER_ENABLED=true` the per-request pin is a no-op:
  PgBouncer transaction-mode pooling plus `server_reset_query = 'DISCARD ALL'`
  already handle GUC lifecycle, and the existing transaction/session semantics
  are preserved unchanged.

### Scope boundary (residual, honest note)

The pin is established inside `requireAuth()` (API routes) and
`requireTenantCtx()` (Server Components), which wrap their bodies in
`withPinnedConnection(...)`. Because Next.js App Router provides no global
per-request async wrapper that user code can hook, and because
`AsyncLocalStorage` scopes are strictly lexical, the pin is active for the
**auth + `setTenantContext` + auth/membership lookups**, and is released when
`requireAuth()` / `requireTenantCtx()` return — i.e. **before** the route
handler's own later `db` queries run in the same function scope. Those
handler-level data queries continue to run on unpinned pool connections.

Consequences and why this is still the right minimal change:

- Application-level `tenant_id` filters (present on the handler queries) remain
  the primary tenant-scoping mechanism, exactly as before.
- The fail-closed RLS policy is preserved as defense-in-depth and is now
  **actually functional** on the pinned scope (previously it was inert on the
  non-PgBouncer path for every scope).
- Fully extending RLS enforcement to every handler's data queries would require
  either wrapping every route handler in `withPinnedConnection` (hundreds of
  edits, out of scope for this bug fix) or a framework-level per-request hook
  that Next.js does not expose. Route handlers (and Server Component pages) can
  opt into full-request pinning today by wrapping their body in
  `withPinnedConnection(async () => { ... })` from `@/lib/db/request-connection`.

See `lib/db/request-connection.ts` for the mechanism and the exact boundary.

## SSL with Let's Encrypt

```bash
# Install certbot
apt install certbot

# Generate certificate (stop nginx first)
docker compose -f deploy/docker-compose.production.yml stop nginx
certbot certonly --standalone -d crm.yourdomain.com

# Copy certs
cp /etc/letsencrypt/live/crm.yourdomain.com/fullchain.pem deploy/nginx/ssl/
cp /etc/letsencrypt/live/crm.yourdomain.com/privkey.pem deploy/nginx/ssl/

# Restart nginx
docker compose -f deploy/docker-compose.production.yml start nginx

# Auto-renewal (add to host crontab)
# 0 3 * * * certbot renew --deploy-hook "docker restart nucrm-nginx"
```

## First-Time Setup

After deployment, navigate to `https://crm.yourdomain.com/setup`:

1. Enter your `SETUP_KEY` value
2. Create the super-admin account (email + password)
3. Choose your industry template
4. You're live!

## Common Operations

```bash
# View logs
docker compose -f deploy/docker-compose.production.yml logs -f app
docker compose -f deploy/docker-compose.production.yml logs -f worker

# Restart app (zero-downtime with 2 replicas)
docker compose -f deploy/docker-compose.production.yml restart app

# Manual backup
bash deploy/scripts/backup.sh

# Health check
bash deploy/scripts/health-check.sh

# Update to latest version
git pull origin main
docker compose -f deploy/docker-compose.production.yml up -d --build app worker
bash deploy/scripts/deploy.sh --migrate
```

## Monitoring

- **Grafana**: `http://your-server-ip:3001` (admin / your password)
- **Sentry**: Errors appear automatically at sentry.io
- **Health**: `https://crm.yourdomain.com/api/health`

## Memory Budget (8 GB)

| Service                           | RAM         |
| --------------------------------- | ----------- |
| App (x2)                          | 1.5 GB      |
| PostgreSQL                        | 1.5 GB      |
| Worker                            | 512 MB      |
| Redis                             | 512 MB      |
| MinIO                             | 512 MB      |
| Monitoring (Prometheus + Grafana) | 512 MB      |
| Nginx + Cron + Exporters          | 256 MB      |
| OS overhead                       | ~1.2 GB     |
| **Total**                         | **~6.5 GB** |

## Troubleshooting

| Symptom                     | Check                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| 502 Bad Gateway             | `docker logs nucrm-nginx` — app may still be starting                          |
| App crashes on start        | `docker logs <app-container>` — usually missing env var                        |
| Database connection refused | `docker exec nucrm-postgres pg_isready`                                        |
| Emails not sending          | Verify `RESEND_API_KEY` in .env, check worker logs                             |
| AI features not working     | Verify `ENCRYPTION_KEY` is set, add API key at `/tenant/settings/ai-providers` |

## Security Checklist

- [ ] All `<<<REQUIRED>>>` values replaced in `.env`
- [ ] SSL certificates installed (not self-signed)
- [ ] `COOKIE_SECURE=true`
- [ ] Ports 5432, 6379, 9000, 9001, 9090, 3001 NOT exposed publicly (bind to 127.0.0.1)
- [ ] Firewall: only 80 and 443 open to public
- [ ] Emergency recovery key stored in a safe separate from `.env`
- [ ] Regular backups running (check `/api/cron/auto-backup` logs)

## Port Reference

| Port | Service                      | Type           | Bind             |
| ---- | ---------------------------- | -------------- | ---------------- |
| 80   | Nginx (reverse proxy → App)  | System service | 0.0.0.0 (public) |
| 3000 | App (Next.js dev/start)      | Host process   | 127.0.0.1        |
| 3001 | Grafana dashboards           | Docker         | 127.0.0.1        |
| 5432 | PostgreSQL                   | Host system    | 127.0.0.1        |
| 6379 | Redis                        | Docker         | 127.0.0.1        |
| 9000 | MinIO S3 API                 | Docker         | 127.0.0.1        |
| 9001 | MinIO Console                | Docker         | 127.0.0.1        |
| 9090 | Prometheus                   | Docker         | 127.0.0.1        |
| 9093 | Alertmanager                 | Docker         | 127.0.0.1        |
| 9100 | Node Exporter (host metrics) | Docker         | 127.0.0.1        |
| 9121 | Redis Exporter               | Docker         | 127.0.0.1        |
| 9187 | PostgreSQL Exporter          | Docker         | 127.0.0.1        |
| 3100 | Loki (log aggregation)       | Docker         | 127.0.0.1        |

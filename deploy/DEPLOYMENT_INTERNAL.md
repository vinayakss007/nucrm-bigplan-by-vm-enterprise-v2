# NuCRM — Super Admin Deployment & Operations Guide (INTERNAL)

> **CONFIDENTIAL** — This document contains credentials, secret rotation procedures, and emergency access paths. Do NOT share publicly.

---

## Complete Service Map

| Service | Internal Port | External Access | Container Name |
|---------|--------------|-----------------|----------------|
| App (Next.js) | 3000 | via nginx :443 | nucrm-app-1, nucrm-app-2 |
| Worker (BullMQ) | - | none | nucrm-worker |
| Cron | - | none | nucrm-cron |
| PostgreSQL | 5432 | 127.0.0.1:5432 | nucrm-postgres |
| Redis | 6379 | 127.0.0.1:6379 | nucrm-redis |
| MinIO (S3) | 9000/9001 | 127.0.0.1:9000 | nucrm-minio |
| Nginx | 80/443 | PUBLIC | nucrm-nginx |
| Prometheus | 9090 | 127.0.0.1:9090 | nucrm-prometheus |
| Grafana | 3000 (→3001) | 127.0.0.1:3001 | nucrm-grafana |
| Node Exporter | 9100 | internal only | nucrm-node-exporter |
| Postgres Exporter | 9187 | internal only | nucrm-postgres-exporter |
| Redis Exporter | 9121 | internal only | nucrm-redis-exporter |

---

## All Environment Variables (Complete Reference)

### CRITICAL SECRETS (rotate every 90 days)

```bash
JWT_SECRET          # Signs all auth tokens. Rotating invalidates ALL sessions.
SESSION_SECRET      # Encrypts session data
ENCRYPTION_KEY      # Encrypts API keys, SSO secrets in DB. Rotating BREAKS stored keys.
EMERGENCY_RECOVERY_KEY  # Last-resort admin access. Store SEPARATELY.
```

### OPERATIONAL SECRETS (rotate annually)

```bash
SETUP_KEY           # First-time setup only. Can be deleted after setup.
CRON_SECRET         # Authenticates cron→app HTTP calls
POSTGRES_PASSWORD   # Database auth
GRAFANA_ADMIN_PASSWORD  # Monitoring dashboard access
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  # MinIO / S3 auth
```

### EXTERNAL SERVICE KEYS

```bash
RESEND_API_KEY              # Email delivery
ANTHROPIC_API_KEY           # Claude AI
OPENAI_API_KEY              # GPT AI
GROQ_API_KEY                # Fast inference
STRIPE_SECRET_KEY           # Billing
STRIPE_WEBHOOK_SECRET       # Stripe→app webhook verification
SENTRY_DSN                  # Error tracking (client-visible)
SENTRY_AUTH_TOKEN           # Source map upload (build-time only)
TELEGRAM_BOT_TOKEN          # Admin alert notifications
WHATSAPP_ACCESS_TOKEN       # Business messaging
TWILIO_AUTH_TOKEN           # SMS/Voice
```

---

## Secret Rotation Procedure

### Rotating JWT_SECRET (invalidates all sessions)

```bash
# 1. Generate new secret
NEW_JWT=$(openssl rand -base64 64 | tr -d '\n')

# 2. Schedule during low-traffic window (users will be logged out)
# 3. Update .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT}|" .env

# 4. Rolling restart
docker compose -f deploy/docker-compose.production.yml restart app worker

# 5. Verify: all users must re-login (expected)
```

### Rotating ENCRYPTION_KEY (DANGEROUS — re-encrypts all stored keys)

```bash
# DO NOT rotate unless compromised. All tenant AI keys, SSO secrets
# are encrypted with this. You'd need a migration script to re-encrypt.
# Contact: the engineer who built lib/ai/secrets.ts
```

### Rotating POSTGRES_PASSWORD

```bash
# 1. Generate new password
NEW_PW=$(openssl rand -base64 32 | tr -d '\n/+=')

# 2. Change in PostgreSQL
docker exec -it nucrm-postgres psql -U nucrm -c "ALTER USER nucrm PASSWORD '${NEW_PW}';"

# 3. Update .env (both POSTGRES_PASSWORD and DATABASE_URL)
# 4. Restart app + worker
docker compose -f deploy/docker-compose.production.yml restart app worker
```

---

## Emergency Procedures

### E1: Admin Locked Out (forgot password, 2FA lost, SMTP down)

```bash
# Use the emergency recovery endpoint:
curl -X POST https://crm.yourdomain.com/api/emergency/recover \
  -H "Content-Type: application/json" \
  -d '{
    "key": "<EMERGENCY_RECOVERY_KEY from .env>",
    "email": "admin@yourdomain.com",
    "new_password": "NewSecureP@ss123!",
    "disable_2fa": true
  }'
# Rate limited: 1 attempt per 5 min per IP
```

### E2: Database Corruption / Need Restore

```bash
# 1. Stop the app
docker compose -f deploy/docker-compose.production.yml stop app worker cron

# 2. Restore from latest backup
bash deploy/scripts/backup.sh --restore /tmp/nucrm-backups/nucrm_backup_YYYYMMDD_HHMMSS.sql.gz

# 3. Restart
docker compose -f deploy/docker-compose.production.yml start app worker cron
```

### E3: Disk Full

```bash
# 1. Check what's using space
docker system df
du -sh /var/lib/docker/volumes/*

# 2. Clean Docker garbage
docker system prune -a --volumes --filter "until=48h"

# 3. Reduce Prometheus retention
# Edit deploy/monitoring/prometheus.yml: --storage.tsdb.retention.time=7d

# 4. Purge old backups
find /tmp/nucrm-backups -mtime +7 -delete
```

### E4: VM Unresponsive

```bash
# From cloud console, hard reboot. Docker services auto-restart.
# After reboot:
bash deploy/scripts/health-check.sh
```

---

## Monitoring Dashboard URLs

**None of the monitoring services are reachable at `SERVER_IP`.** Every one of them
is published to `127.0.0.1` in `docker-compose.production.yml`, and UFW allows only
22, 80 and 443 inbound. Open an SSH tunnel first, then use the localhost URL.

```bash
# One tunnel for everything (leave it running in its own terminal)
ssh -N \
  -L 3001:127.0.0.1:3001 \
  -L 9090:127.0.0.1:9090 \
  -L 9093:127.0.0.1:9093 \
  -L 3100:127.0.0.1:3100 \
  -L 9001:127.0.0.1:9001 \
  DEPLOY_USER@SERVER_IP
```

| Dashboard | URL (with the tunnel up) | Credentials |
|-----------|--------------------------|-------------|
| Grafana | http://localhost:3001 | `GRAFANA_ADMIN_USER` (default `admin`) / `GRAFANA_ADMIN_PASSWORD` |
| Prometheus | http://localhost:9090 | none — the tunnel *is* the access control |
| Alertmanager | http://localhost:9093 | none |
| Loki | http://localhost:3100 | none — queried through Grafana, rarely direct |
| MinIO Console | http://localhost:9001 | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |
| Sentry | https://sentry.io/organizations/YOUR_ORG/ | Your Sentry account |

Prometheus, Alertmanager and Loki have **no authentication of their own**. They are
safe only because they are not listening on a public interface. Do not publish them
by changing the port bindings or by adding UFW rules; anyone who reaches Prometheus
can read every metric, and anyone who reaches Alertmanager can silence alerts.

If the team outgrows tunnels, put the services behind an authenticating proxy
(Cloudflare Access, Tailscale, or nginx with OIDC) rather than opening the ports.

### Key Grafana Metrics to Watch

| Metric | Warning | Critical |
|--------|---------|----------|
| Memory usage | > 80% | > 90% |
| CPU usage | > 70% | > 85% |
| Disk usage | > 75% | > 85% |
| Postgres connections | > 40 | > 50 (max 60) |
| Redis memory | > 400MB | > 450MB (max 512MB) |
| App response time P95 | > 500ms | > 2000ms |
| Error rate (Sentry) | > 1/min | > 10/min |

---

## Cron Jobs Running

| Schedule | Job | What it does |
|----------|-----|--------------|
| */5 min | process-sequences | Advance email sequences |
| */10 min | retry-webhooks | Retry failed webhook deliveries |
| Hourly | task-reminders | Send task due notifications |
| Daily 00:00 | trial-check | Expire trial tenants |
| Weekly Sun | usage-snapshot | Record usage stats |
| Daily 02:00 | auto-backup | PostgreSQL dump → S3 |
| Weekly Sun 03:00 | backup-health | Verify backup integrity |
| Weekly Sun 04:00 | cleanup | Purge soft-deleted records >30d |
| Daily 05:00 | subscription-check | Catch missed Stripe webhooks |
| 3x daily | warmup-emails | Email deliverability warm-up |

---

## Update / Upgrade Procedure

```bash
# 1. Backup first
bash deploy/scripts/backup.sh

# 2. Pull latest code
git pull origin main

# 3. Rebuild and restart (zero-downtime due to 2 replicas)
docker compose -f deploy/docker-compose.production.yml up -d --build app worker

# 4. Run migrations
docker compose -f deploy/docker-compose.production.yml exec app npx tsx scripts/push-db.mts

# 5. Verify
bash deploy/scripts/health-check.sh
```

---

## Firewall Rules (UFW)

```bash
# Only these ports should be public:
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (redirects to HTTPS)
ufw allow 443/tcp     # HTTPS
ufw enable

# All other ports (5432, 6379, 9000, 9001, 9090, 3001) are
# bound to 127.0.0.1 in docker-compose.production.yml
```

---

## Cost Estimate (Monthly)

| Item | Provider Example | Cost |
|------|-----------------|------|
| VM 8GB/4vCPU | Hetzner CX32 / DigitalOcean | ~$20-40 |
| Domain | Cloudflare | ~$10/year |
| Resend (email) | 3000 free/month, then $20 | $0-20 |
| Sentry | 5K errors free, then $26 | $0-26 |
| LLM (Anthropic) | Pay per token | $5-50 |
| Stripe | 2.9% + 30c per transaction | Variable |
| **Total (base)** | | **~$25-50/month** |

---

## Files Created by This Deployment

```
deploy/
├── .env.production              # Template with ALL vars documented
├── generate-secrets.sh          # One-time secret generation
├── docker-compose.production.yml  # Full stack (13 containers)
├── nginx/
│   ├── nginx-production.conf    # SSL + rate limiting + proxy
│   └── ssl/                     # Put certs here
├── postgres/
│   ├── postgresql.conf          # Tuned for 8GB VM
│   └── init.sql                 # Extensions + initial setup
├── cron/
│   ├── crontab                  # All scheduled jobs
│   └── run-cron.sh              # HTTP caller
├── monitoring/
│   ├── prometheus.yml           # Scrape config
│   ├── alerts.yml               # Alert rules
│   └── grafana/
│       ├── provisioning/        # Auto-configured datasources
│       └── dashboards/          # Import community dashboards
├── scripts/
│   ├── deploy.sh                # Full deployment automation
│   ├── backup.sh                # Manual backup + restore
│   └── health-check.sh          # Service health verification
└── DEPLOYMENT_INTERNAL.md       # THIS FILE (super-admin only)
```

---

## Runbook: Migration Ledger Drift Recovery (Incident 2026-07-31)

### Symptoms
- `npm run db:migrate` fails with `ERROR: Database has schema but it is NOT at the latest migration state`
- App API writes fail with `column "..." does not exist` (e.g. `team_id` on contacts)
- `drizzle.__drizzle_migrations` is empty (or shorter than the journal) while tables exist

### Root Cause
A database provisioned with `db:push`/`db:sync` or restored from an older dump has
schema but no migration ledger, or a ledger shorter than the current schema state.
The recovery check in `scripts/migrate.ts` now verifies the LAST journal
migration's marker (`backup_records.last_verified_at` from 0044) before stamping —
a drifted DB is refused instead of being silently stamped as fully migrated.

### Recovery Steps
1. **Back up first** (non-negotiable):
   ```bash
   pg_dump "$DATABASE_URL" > /tmp/pre-recovery-$(date +%F).sql
   ```
2. **Determine which migrations are actually applied** — check markers from the
   last few migrations against the schema:
   ```bash
   psql "$DATABASE_URL" -c "
   SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name='teams')          AS m0041_teams,
          EXISTS(SELECT FROM information_schema.columns WHERE table_name='backup_records'
                AND column_name='last_verified_at')                                        AS m0044_backup_verif,
          EXISTS(SELECT FROM information_schema.tables WHERE table_name='backup_verifications') AS m0044_table;
   "
   ```
   Missing markers = migrations that were never applied.
3. **Apply only the missing migration SQL** (they are idempotent — `IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, no destructive ops):
   ```bash
   for m in 0040_lead_product_service_request 0041_teams 0042_audit_log_immutability \
            0043_audit_logs_retain_actor 0044_backup_verification; do
     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/migrations/$m.sql
   done
   ```
4. **Re-run db:migrate** — the last-marker check now passes and the ledger is
   stamped from the journal. Verify:
   ```bash
   npm run db:migrate -- --yes
   psql "$DATABASE_URL" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"
   ```
   (Count must equal `jq '.entries | length' drizzle/migrations/meta/_journal.json`.)
5. **Smoke test the app** — create a contact and a deal; both must return 2xx.

### Prevention
- Never provision with `db:sync`/`db:push` on production — always `db:migrate`.
- If a dump restore is required, restore the `drizzle` schema too (it holds the ledger).
- After any restore, run the marker check in step 2 BEFORE pointing traffic at the DB.

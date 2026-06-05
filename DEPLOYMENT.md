# NuCRM — Deployment Guide

Production deployment on a single VM (8 GB RAM recommended).

## Prerequisites

| Service | Minimum | Recommended |
|---------|---------|-------------|
| VM RAM | 4 GB | 8 GB |
| CPU | 2 vCPU | 4 vCPU |
| Disk | 40 GB SSD | 80 GB SSD |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 |
| Docker | 24+ | Latest |

### External Services Required

| Service | Purpose | Where to get |
|---------|---------|--------------|
| **Domain + DNS** | Public URL | Any registrar |
| **Email (Resend)** | Transactional email | [resend.com](https://resend.com) |
| **Sentry** | Error tracking | [sentry.io](https://sentry.io) |
| **LLM API key** | AI features | OpenAI / Anthropic / Groq |
| Stripe *(optional)* | Billing | [stripe.com](https://stripe.com) |
| Telegram Bot *(optional)* | Admin alerts | [@BotFather](https://t.me/BotFather) |

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

| Section | Variables | Notes |
|---------|-----------|-------|
| Core | `NEXT_PUBLIC_APP_URL`, `ALLOWED_ORIGINS` | Your public domain |
| Auth | `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `SETUP_KEY` | Generated secrets |
| Database | `DATABASE_URL`, `POSTGRES_PASSWORD` | Auto-configured in Docker |
| Redis | `REDIS_URL` | `redis://redis:6379` in Docker |
| Storage | `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID/SECRET` | MinIO or external S3 |
| Email | `RESEND_API_KEY` | From resend.com dashboard |
| AI | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | At least one required |
| Sentry | `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | From sentry.io |
| Monitoring | `GRAFANA_ADMIN_PASSWORD` | For Grafana login |
| Billing | `STRIPE_SECRET_KEY` *(optional)* | For paid plans |

See `deploy/.env.production` for the full documented template.

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

| Service | RAM |
|---------|-----|
| App (x2) | 1.5 GB |
| PostgreSQL | 1.5 GB |
| Worker | 512 MB |
| Redis | 512 MB |
| MinIO | 512 MB |
| Monitoring (Prometheus + Grafana) | 512 MB |
| Nginx + Cron + Exporters | 256 MB |
| OS overhead | ~1.2 GB |
| **Total** | **~6.5 GB** |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 Bad Gateway | `docker logs nucrm-nginx` — app may still be starting |
| App crashes on start | `docker logs <app-container>` — usually missing env var |
| Database connection refused | `docker exec nucrm-postgres pg_isready` |
| Emails not sending | Verify `RESEND_API_KEY` in .env, check worker logs |
| AI features not working | Verify `ENCRYPTION_KEY` is set, add API key at `/tenant/settings/ai-providers` |

## Security Checklist

- [ ] All `<<<REQUIRED>>>` values replaced in `.env`
- [ ] SSL certificates installed (not self-signed)
- [ ] `COOKIE_SECURE=true`
- [ ] Ports 5432, 6379, 9000, 9001, 9090, 3001 NOT exposed publicly (bind to 127.0.0.1)
- [ ] Firewall: only 80 and 443 open to public
- [ ] Emergency recovery key stored in a safe separate from `.env`
- [ ] Regular backups running (check `/api/cron/auto-backup` logs)

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Deployment-category documentation content extracted from docs-client.
 * Real, production-tested deployment guides for operators and administrators.
 */
export const DEPLOYMENT_DOCS: Record<string, { title: string; content: string }> = {
  'deployment/guide': {
    title: 'Deployment Guide',
    content: `# Production Deployment Guide

How to deploy, configure, and maintain NuCRM in production environments.

> [!NOTE]
> NuCRM is an enterprise multi-tenant CRM built with Next.js, PostgreSQL (with Row-Level Security), and Redis.

---

## Architecture Overview

A production NuCRM installation consists of four core tiers:

1. **Web Application Tier** — Next.js 15 App Router running standalone under Node.js 22+ or PM2.
2. **Reverse Proxy & TLS** — Nginx terminating SSL/TLS, enforcing Content Security Policy (CSP), and proxying requests.
3. **Database Tier** — PostgreSQL 15+ enforced with Row-Level Security (RLS) and connection pooling via PgBouncer.
4. **Cache & Queue Tier** — Redis instance backing BullMQ background job queues, rate limiting, and real-time events.

---

## System Requirements

- **Operating System:** Ubuntu 22.04 LTS / Debian 12 / Linux kernel 5.15+
- **CPU:** 2 vCPU minimum (4+ vCPU recommended for >50 users)
- **Memory:** 4 GB RAM minimum (8 GB RAM recommended for full stack + build)
- **Disk:** 40 GB SSD minimum with automated volume backups
- **Node.js:** v22.0+ (LTS)
- **PostgreSQL:** v15+ (with RLS support)
- **Redis:** v7+

---

## Deployment Steps (Bare Metal / VM)

### 1. Clone & Install Dependencies

\`\`\`bash
git clone https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git
cd nucrm-bigplan-by-vm-enterprise-v2
npm ci --production=false
\`\`\`

### 2. Configure Environment

Copy \`.env.example\` to \`.env.production\` and populate mandatory secrets:

\`\`\`bash
cp .env.example .env.production
\`\`\`

> [!WARNING]
> Never commit secrets or passwords to git. Always use strong 64-character random strings for \`JWT_SECRET\` and \`SESSION_SECRET\`.

### 3. Run Database Migrations

Apply schema migrations safely with the built-in migration tool:

\`\`\`bash
NODE_ENV=production npm run db:migrate
\`\`\`

### 4. Build the Application

\`\`\`bash
NODE_OPTIONS="--max-old-space-size=4096" npm run build
\`\`\`

### 5. Launch with PM2

\`\`\`bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
\`\`\`

---

## Health Check Gate

Verify the deployed application status:

\`\`\`bash
curl -f http://127.0.0.1:3099/api/health
\`\`\`

A healthy instance returns \`{"status":"healthy","database":"connected","redis":"connected"}\`.
`,
  },

  'deployment/docker': {
    title: 'Docker Deployment',
    content: `# Docker Deployment & Container Architecture

NuCRM provides containerized configurations for development, pre-production, and production.

> [!TIP]
> Use \`docker-compose.production.yml\` for automated, isolated multi-container deployments.

---

## Container Stack Services

The complete containerized stack includes:

- **\`nucrm-app\`** — Next.js production build running in standalone mode (unprivileged user \`nextjs\`).
- **\`nucrm-nginx\`** — Reverse proxy with rate limiting, SSL termination, and security headers.
- **\`nucrm-pgbouncer\`** — Connection pooler in session mode maintaining tenant RLS invariants.
- **\`nucrm-db\`** — PostgreSQL 15 database persisting data in the \`pgdata\` named volume.
- **\`nucrm-redis\`** — Redis instance for caching and job queue processing.

---

## Running with Docker Compose

### 1. Environment Preparation

Ensure \`.env\` contains valid production credentials and database passwords:

\`\`\`bash
docker compose -f deploy/docker-compose.production.yml config
\`\`\`

### 2. Start Services

\`\`\`bash
docker compose -f deploy/docker-compose.production.yml up -d
\`\`\`

### 3. Check Container Health

\`\`\`bash
docker compose -f deploy/docker-compose.production.yml ps
\`\`\`

---

## Volume Persistence & Safety

> [!CAUTION]
> PostgreSQL data is stored in the Docker named volume \`pgdata\`.
> **NEVER** run \`docker compose down -v\` in production, as the \`-v\` flag destroys persistent database volumes.

- **Safe:** \`docker compose restart\` or \`docker compose down && docker compose up -d\`
- **Destructive:** \`docker compose down -v\` or \`docker volume prune\`
`,
  },

  'deployment/env': {
    title: 'Environment Variables',
    content: `# Environment Variables Reference

Complete reference of all configuration options supported by NuCRM.

> [!IMPORTANT]
> In production, configure all variables marked **Required**. Missing secrets will halt boot validation.

---

## Core Application & Database

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| \`DATABASE_URL\` | **Yes** | — | PostgreSQL connection string (\`postgresql://user:pass@host:5432/nucrm\`) |
| \`DATABASE_POOL_SIZE\` | No | \`10\` | Maximum database connection pool size |
| \`PGBOUNCER_ENABLED\` | No | \`false\` | Set \`true\` when routing via PgBouncer session pooling |
| \`JWT_SECRET\` | **Yes** | — | 64+ char secret used for signing auth tokens |
| \`SESSION_SECRET\` | **Yes** | — | 64+ char secret for HTTP-only session cookies |
| \`NEXTAUTH_URL\` | **Yes** | — | Canonical app origin (e.g. \`https://crm.example.com\`) |

---

## Redis & Background Queues

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| \`REDIS_URL\` | **Yes** | — | Redis connection URL (\`redis://:password@host:6379/0\`) |
| \`REDIS_PASSWORD\` | No | — | Redis password if not encoded in URL |
| \`QUEUE_CONCURRENCY\` | No | \`5\` | Number of parallel worker jobs |

---

## Security & Crons

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| \`CRON_SECRET\` | **Yes** | — | Bearer token authorizing scheduled cron triggers |
| \`SETUP_KEY\` | **Yes** | — | Secret authorizing the initial platform bootstrap |
| \`ENCRYPTION_KEY\` | **Yes** | — | 32-byte hex key for encrypting stored credentials |

---

## Email & Integrations (Optional)

| Variable | Default | Description |
| --- | --- | --- |
| \`SMTP_HOST\` | — | Outbound SMTP server hostname |
| \`SMTP_PORT\` | \`587\` | Outbound SMTP server port |
| \`SMTP_USER\` | — | SMTP username / API key |
| \`SMTP_PASS\` | — | SMTP password / API token |
| \`SENTRY_DSN\` | — | Sentry error tracking DSN |
`,
  },

  'deployment/backup': {
    title: 'Backup & Restore',
    content: `# Backup & Disaster Recovery

Comprehensive procedures for data protection, scheduled backups, and restoration.

> [!IMPORTANT]
> Test backup restoration regularly on staging to ensure recovery time objectives (RTO) are met.

---

## Automated Backups

NuCRM includes an automated backup pipeline in \`scripts/backup-db.ts\` that:
1. Executes an atomic \`pg_dump\` using custom format (\`-Fc\`).
2. Encrypts and streams the dump to S3-compatible object storage.
3. Enforces a 30-day retention lifecycle with automatic cleanup.

### Running Backups Manually

\`\`\`bash
npm run db:backup
\`\`\`

---

## Manual Quick Backup

To take an immediate snapshot before running migrations or critical changes:

\`\`\`bash
pg_dump -Fc "$DATABASE_URL" > "nucrm-backup-$(date +%Y%m%d-%H%M%S).dump"
\`\`\`

---

## Restoration Procedures

### Full Database Restore

\`\`\`bash
# 1. Terminate active application connections
pm2 stop nucrm-prod

# 2. Restore schema and data
pg_restore --clean --if-exists -d "$DATABASE_URL" "nucrm-backup.dump"

# 3. Restart application
pm2 restart nucrm-prod
\`\`\`

> [!WARNING]
> Restoring a database overwrites existing records. Always verify the backup target before executing.
`,
  },
};

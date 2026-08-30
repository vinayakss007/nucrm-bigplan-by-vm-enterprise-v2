# Configuration Reference

Every environment variable NuCRM uses, grouped by purpose. The authoritative, commented source is
[`.env.example`](../../.env.example) — copy it to `.env.local` and fill in values.

> **Secrets discipline:** never commit real secrets. Generate strong values (commands are noted in
> `.env.example`). Production processes load config from `.env.local`; the PM2 config contains no
> secrets.

---

## Core (required)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATABASE_SSL` | Enable TLS to the database (`true` in production). |
| `DATABASE_POOL_SIZE` | Primary pool size. |
| `JWT_SECRET` | Signs session JWTs. **Required.** `openssl rand -base64 64`. |
| `SESSION_SECRET` | Session signing secret. `openssl rand -base64 48`. |
| `SETUP_KEY` | Guards the initial `create-admin` setup. `openssl rand -hex 32`. |
| `CRON_SECRET` | Authenticates cron endpoint calls. `openssl rand -base64 64`. |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL. |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins. |
| `NODE_ENV` | `development` / `production`. |
| `TRUST_PROXY` | Set `true` **only** behind a trusted proxy (nginx/Vercel). Controls whether client IPs are read from proxy headers for rate limiting. |

---

## Cron hardening (optional)

| Variable | Purpose |
| --- | --- |
| `CRON_ALLOWED_IPS` | Comma/space-separated IPs/CIDRs allowed to call `/api/cron/*` (requires `TRUST_PROXY=true`). |
| `CRON_SIGNING_KEY` | When set, cron callers must send `x-cron-signature: sha256=<hmac>`. |

---

## Redis

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | Redis connection (queues, cache, socket.io adapter). |

---

## Email (required for invites, resets, notifications)

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key (preferred provider). |
| `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Sender identity. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP fallback (used only if Resend is unset). |

> With neither Resend nor SMTP configured, email will not send; in production this surfaces as
> `degraded` in the system health endpoint.

---

## Messaging & voice

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp (Meta Cloud API). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Twilio SMS/voice. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot (register webhook via `npm run telegram:setup-webhook`). |

---

## Object storage (S3 / R2 / MinIO)

| Variable | Purpose |
| --- | --- |
| `S3_ACCESS_KEY_ID` / `S3_ACCESS_KEY` / `AWS_ACCESS_KEY_ID` | Access key (first non-empty wins). |
| `S3_SECRET_ACCESS_KEY` / `S3_SECRET_KEY` / `AWS_SECRET_ACCESS_KEY` | Secret key. |
| `S3_BUCKET` | Bucket for uploaded files (and backups if `BACKUP_BUCKET` unset). |
| `BACKUP_BUCKET` | Dedicated bucket for database backups. |
| `S3_REGION` | Region (`auto` for R2, else `us-east-1`). |
| `S3_ENDPOINT` | Custom endpoint (e.g. Cloudflare R2). |

> If bucket + access key + secret key aren't all present, off-site storage is treated as
> unconfigured and backups stay on the app host only — which does **not** survive a container
> restart. See [Backups & DR](./backups-dr.md).

---

## Backups & encryption

| Variable | Purpose |
| --- | --- |
| `BACKUP_RETENTION_DAYS` (alias `BACKUP_KEEP_DAYS`) | Retention window (positive integer). |
| `BACKUP_ENCRYPTION_KEY` | AES-256-GCM key; when set, `pg_dump` output is encrypted before upload. |
| `BACKUP_ENCRYPTION_KEY_PREV` | Previous key kept during rotation so older backups stay restorable. |
| `ENCRYPTION_KEY` | Field-level / backup security key. `openssl rand -hex 32`. |

---

## Read replica (optional)

| Variable | Purpose |
| --- | --- |
| `DATABASE_READ_REPLICA_URL` | When set, heavy reads (reports, search, analytics, export) route here. |
| `DATABASE_READ_POOL_SIZE` | Replica pool size. |
| `DATABASE_READ_STATEMENT_TIMEOUT` | Replica statement timeout (ms). |

---

## Billing

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe. |
| (Razorpay / PayU keys) | Additional gateways where enabled (see `lib/razorpay.ts`, `lib/payu.ts`). |

---

## Observability & alerting

| Variable | Purpose |
| --- | --- |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking (initializes when set). |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Sentry project/build config. |
| `SENTRY_DISABLE` | Set `true` to disable Sentry entirely. |
| `SENTRY_TRACES_SAMPLE_RATE` | Trace sampling (e.g. `0.1`). |
| `CRITICAL_ERROR_WEBHOOK_URL` | Fatal errors POST here (rate-limited). |
| `PAGERDUTY_ROUTING_KEY`, `PAGERDUTY_ENABLED` | PagerDuty Events API v2. |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | Grafana admin (change in production). |
| `METRICS_SECRET` | Bearer secret protecting the Prometheus `/api/metrics` endpoint. |

---

## Webhook secrets

| Variable | Purpose |
| --- | --- |
| `RESEND_WEBHOOK_SECRET` | Verify Resend delivery webhooks. |
| `WHATSAPP_APP_SECRET` | Verify WhatsApp webhooks. |

---

## Marketing site

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap/robots/canonical URLs. |
| `NEXT_PUBLIC_MARKETING_TENANT_ID` | Workspace that `/contact` enquiries file into as leads. |

---

## Configuration precedence & tips

- Local development reads `.env.local`. Production processes also load `.env.local` (via PM2
  `env_file`).
- Restart/reload processes after changing config: `pm2 reload ecosystem.config.cjs`.
- Validate the environment with `npm run preflight` / `npm run prod:preflight` before launch.

---

## Related

- [Deployment](./deployment.md) · [Security & Compliance](./security.md)
- [Monitoring & Observability](./monitoring.md) · [Backups & DR](./backups-dr.md)

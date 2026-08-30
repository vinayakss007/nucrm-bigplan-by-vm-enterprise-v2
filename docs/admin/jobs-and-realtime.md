# Background Jobs & Realtime

The asynchronous side of NuCRM: the background worker, the job queue, scheduled cron jobs, and the
realtime server.

---

## The worker

[`worker.ts`](../../worker.ts) is a dedicated process that consumes jobs from the queue. It handles:

| Job | What it does |
| --- | --- |
| `send-email` | Transactional email delivery. |
| `send-notification` | In-app / push notifications. |
| `send-bulk-emails` | Bulk sends processed in parallel batches (recipient names XSS-escaped). |
| `run-automation` | Executes workflows/rules via `lib/automation/engine.ts`. |
| `send-lead-warming` | Lead-warming touchpoints (WhatsApp) with claim-before-send idempotency and token-expiry handling. |
| `whatsapp-webhook` | Processes inbound WhatsApp events. |
| `webhooks` | Delivers outbound webhooks via `lib/webhooks/delivery.ts`. |

Each worker uses a dedicated Redis connection, enforces job-retention limits, emits a **30-second
heartbeat**, and shuts down gracefully (30s kill timeout) to finish in-flight jobs. In production,
PM2 runs **2 worker instances** by default (`NUCRM_WORKER_INSTANCES`).

Run locally: `npm run worker` (or `npm run dev:all` for web + worker together).

---

## The queue

[`lib/queue`](../../lib/queue) is a hybrid abstraction that auto-detects the best available backend:

```
Redis (BullMQ)  →  pg-boss (Postgres)  →  in-memory (last resort)
```

- **Redis/BullMQ** is the production path.
- **pg-boss** is a fallback when Redis is unavailable but Postgres is present.
- **In-memory** exists only for degraded/local scenarios and does not survive a restart.

This graceful degradation keeps the app functional even if Redis blips, though production should
always have Redis.

---

## Cron jobs

Scheduled work is exposed as HTTP endpoints under `app/api/cron/*` and triggered either by the PM2
`cron` app (`scripts/cron-scheduler.ts`) or a host crontab (`deploy/cron/`).

> **Run exactly one cron source per environment** — never both — to avoid duplicate execution.

Cron endpoints are authenticated with **`CRON_SECRET`**, optionally hardened with
`CRON_ALLOWED_IPS` and `CRON_SIGNING_KEY` (HMAC). Source: `lib/auth/cron.ts`.

### The scheduled jobs (~22)

| Job | Purpose |
| --- | --- |
| `auto-backup`, `backup`, `backup-verify`, `backup-health` | Database backup + verification. |
| `cleanup` | Purge expired sessions, trash, and stale data. |
| `usage-snapshot` | Capture per-tenant usage snapshots. |
| `task-reminders` | Task reminder notifications. |
| `process-sequences` | Advance email sequences. |
| `process-lead-scoring` | Recompute lead scores. |
| `process-at-risk` | At-risk/churn detection. |
| `lead-warming`, `warmup-emails` | Lead warming + email warmup scheduling. |
| `ai-auto-followup` | AI-driven follow-up generation. |
| `retry-webhooks` | Retry failed outbound webhooks. |
| `subscription-check`, `subscription-renewal-check` | Subscription billing lifecycle. |
| `recurring-invoice-generator` | Generate recurring invoices. |
| `contract-renewal-check` | Contract renewal reminders. |
| `trial-check` | Trial expiry handling. |
| `sla-check` | SLA breach detection. |
| `detect-missed-followups` | Surface overdue follow-ups. |
| `scheduled-report-delivery` | Deliver scheduled reports. |

---

## Realtime

[`realtime.ts`](../../realtime.ts) is a **standalone socket.io server** with a **Redis adapter** for
multi-instance fan-out.

- **Public path:** nginx proxies **`/socket.io/`** to this process (it is not exposed directly).
- **Auth:** the socket handshake is authenticated from the JWT session **cookie**; the server
  derives the tenant/user **rooms** from the verified session — clients cannot choose arbitrary
  rooms.
- **Events:** server-side code publishes to a Redis channel (`lib/realtime/events.ts`); connected
  clients receive live updates (notifications, unread counts, record changes).
- **Client:** the SDK `RealtimeSDK` (`lib/sdk/realtime.ts`) subscribes on the browser side.

Run locally: `npm run realtime`.

---

## Operating tips

- If notifications/emails/automations stop, **check the worker first** (heartbeat, logs, queue
  depth) — see [Monitoring](./monitoring.md).
- If live updates stop, check the **realtime** process and the nginx `/socket.io/` proxy.
- After deploying config changes, `pm2 reload ecosystem.config.cjs` to restart web/worker/cron.

---

## Related

- [Architecture](./architecture.md) · [Deployment](./deployment.md)
- [Monitoring & Observability](./monitoring.md)
- [Configuration → Cron hardening](./configuration.md#cron-hardening-optional)

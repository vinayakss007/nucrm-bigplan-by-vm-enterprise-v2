# Monitoring & Observability

How to see what the platform is doing and get alerted when something breaks.

---

## The observability stack

| Tool                | Role                                            | Config                                      |
| ------------------- | ----------------------------------------------- | ------------------------------------------- |
| **Sentry**          | Error/exception tracking (client, server, edge) | `sentry.*.config.ts`, `instrumentation*.ts` |
| **Prometheus**      | Metrics collection                              | `monitoring/`, `deploy/monitoring/`         |
| **Grafana**         | Dashboards over Prometheus/Loki                 | `monitoring/`                               |
| **Loki + Promtail** | Log aggregation and shipping                    | `deploy/monitoring/`                        |
| **Alertmanager**    | Routes alerts (Slack, webhook)                  | `deploy/monitoring/`                        |
| **Exporters**       | node / redis / postgres exporters               | docker-compose `monitoring` profile         |
| **PagerDuty**       | On-call incident paging                         | `lib/pagerduty.ts`                          |

Bring the stack up locally with `docker compose --profile monitoring up -d`. See
[Deployment](./deployment.md).

---

## Health checks

| Endpoint                              | Purpose                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                     | Basic liveness.                                                                                                             |
| `GET /api/system/health`              | Detailed health incl. dependency status (DB, Redis, email); reports `degraded` when, e.g., no email provider is configured. |
| **Super-Admin → Health / Monitoring** | Operator UI for system + worker status.                                                                                     |

Use `/api/health` for load-balancer liveness and `/api/system/health` for deeper diagnostics.

---

## Metrics

- **Prometheus metrics** are exposed at **`/api/metrics`**, protected by a bearer token
  (`METRICS_SECRET`). Point your Prometheus scrape config at it with the token.
- Grafana dashboards visualize request rates, latencies, queue depth, and system resources.
- Grafana admin credentials come from `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` — change
  these in production.

---

## Logs

- Application logs are written per PM2 app (see `NUCRM_LOG_DIR`, default `./logs`): `web-*.log`,
  `worker-*.log`, `cron-*.log`.
- In the monitoring stack, **Promtail** ships logs to **Loki** for querying in Grafana.
- Quick tails: `npm run logs:watch` (all), `npm run logs:errors` (errors only). A simple
  `scripts/log-viewer.html` is included for local inspection (or run `npm run logs:view`).
- **Super-Admin → Logs / Errors** provides an in-app view of application logs and captured errors.

---

## Alerting

| Signal           | Destination                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| **Fatal errors** | POST to `CRITICAL_ERROR_WEBHOOK_URL` (rate-limited to avoid storms).   |
| **PagerDuty**    | Set `PAGERDUTY_ROUTING_KEY` to page on-call for critical incidents.    |
| **Alertmanager** | Routes Prometheus alerts (thresholds defined in `deploy/monitoring/`). |
| **Sentry**       | Notifies on new/spiking exceptions.                                    |

---

## What to watch

- **Worker heartbeat** — the worker writes a heartbeat (`worker:heartbeat`) every ~30s; a stale
  heartbeat means background jobs (emails, automations, webhooks) are stalled.
- **Queue depth / failures** — growing queues or dead-letter entries indicate downstream problems.
- **DB health** — connection saturation, slow queries, replication lag (if using a read replica).
- **Email health** — `degraded` status usually means the email provider is misconfigured.
- **Rate-limit hits** — spikes may indicate abuse or a misbehaving integration.

---

## Related

- [Deployment](./deployment.md) — bringing up the monitoring profile
- [Configuration → Observability](./configuration.md#observability--alerting)
- [Jobs & Realtime](./jobs-and-realtime.md) — worker/queue internals
- [Operations Runbooks](./runbooks.md) — what to do when an alert fires

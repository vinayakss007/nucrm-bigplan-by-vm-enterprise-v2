# Deployment Paths — read this before deploying (#1425)

## ✅ DECISION (canonical)

- **Production → PM2 on the VM** (Path A). App/worker/cron run under PM2 via a
  git-based update (`.github/workflows/deploy.yml`). In production Docker is
  used **only** for the infra/monitoring stack
  (`deploy/docker-compose.production.yml` — Postgres/Redis/MinIO/Prometheus/
  Grafana/Loki), never for the app itself.
- **Development → Docker** (Path B). The root `docker-compose.yml` runs the full
  stack (app + worker + infra) locally for convenience. Do **not** use it to
  serve production.

Never run the production PM2 app and a Docker app container against the same
host at once — they both bind port 3000.

The two paths are described below for reference.

## Queue Redis memory policy

The full local, scale, production, and pre-production Compose stacks use Redis
for BullMQ jobs as well as cache data. These stacks must use
`--maxmemory-policy noeviction`: an eviction policy can delete pending job data.
At the memory limit, writes fail visibly instead of silently removing jobs.
Existing AOF persistence settings and volumes are unchanged; this policy is not
a substitute for backups or a tested restore procedure.

Monitor Redis memory usage, rejected writes, queue age and failed jobs. Before
reaching the limit, increase the memory budget with container/host headroom or
separate the cache and queue Redis instances. Never use `FLUSHDB` to recover
capacity on a queue instance. The slim stack remains ephemeral, development-only
and unsuitable for durable jobs.

Validate this contract without starting services:

```bash
npx vitest run tests/unit/docker-compose-scale.test.ts
```

The existing CI unit-test job includes this regression test. Roll out the Redis
configuration separately during an approved maintenance window; creating or
merging a PR does not prove that the running server has picked up the policy.

## Path A — PM2 on the VM (git-based updates)

The app + worker (+ optional cron) run as PM2 processes directly on the host;
Docker is used **only for the monitoring stack**.

- Config: `ecosystem.config.cjs` (the single canonical PM2 config — #1424)
- Start: `pm2 start ecosystem.config.cjs`
- Updates: `git pull && npm ci && npm run build && pm2 reload ecosystem.config.cjs --update-env`
- Runtime flags: `npm run assert:runtime-env` before the reload, and note the
  `--update-env` there is not cosmetic (#3271). PM2 replays the environment it
  captured at first `start`, so a flag added to the config — `TRUST_PROXY` is the
  one that matters — does not reach live workers without it, and `.env.local`
  alone cannot supply it either. `deploy.yml` already restarts with
  `--update-env`; a hand-run reload that omits it is the gap.
- Monitoring: `docker compose -f deploy/docker-compose.production.yml up -d`
  (Prometheus/Grafana/Loki only)
- Cron: host crontab (`deploy/cron/crontab`) **or** the PM2 `cron` app — never both.
- Referenced by: `PRODUCTION_CHECKLIST.md`, `.kiro/steering/scaling-strategy.md`,
  `docs/planning/MAINTENANCE_UPDATE_GUIDE.md`.

**To make Path A canonical:** remove the `nucrm-enterprise-web` and
`nucrm-enterprise-worker` services from the root `docker-compose.yml`, and stop
building/pushing the GHCR app image in `.github/workflows/deploy.yml` (keep the
monitoring compose + the pm2 reload step).

### Path A edge — the names nginx and Prometheus use (#3263)

`deploy/nginx/nginx-production.conf` proxies to `app:3000` and `realtime:4001`,
and `deploy/monitoring/prometheus.yml` scrapes `app`. Those are **compose
service names**. On Path A the app and realtime are PM2 processes on the host,
so neither name resolves inside a container: the edge answers 502 and the
`nucrm-app` target list is empty while the rest of the monitoring plane looks
healthy.

The repo's decision is the **alias** fix, not templating the configs:
`deploy/docker-compose.pm2-edge.yml` maps `app`, `realtime` and `web` to
`host-gateway` for exactly the two containers that need them, and the
provisioning script applies it with `--no-deps` and then proves the edge can
reach the host process:

```bash
# Path A only. Refuses when the compose 'app' service is running, because
# extra_hosts would shadow the container and route the edge to the host.
bash deploy/scripts/provision-pm2-edge.sh
```

The PM2 app must listen on an address the bridge can reach — `NUCRM_HOST=0.0.0.0`
(or the gateway address) in `ecosystem.config.cjs`, not the default `127.0.0.1`
— and on the port the nginx upstream names. The script checks the host process
first, then `getent hosts app` and a real `http://app:<port>/api/health` request
from inside `nucrm-nginx`, so a loopback-only PM2 app fails loudly instead of
leaving a green-looking edge.

`app` and `realtime` stay the single spelling in both configs; the topology
supplies the resolution. Reverting to the compose edge is the same command
without `-f deploy/docker-compose.pm2-edge.yml`.

## Path B — Docker image (GHCR) on the VM

The app + worker run as containers from a published image.

- App services: `docker-compose.yml` → `nucrm-enterprise-web`,
  `nucrm-enterprise-worker` (`network_mode: host`)
- Image: built + pushed to GHCR by `.github/workflows/deploy.yml`
- Updates: pull the new image tag and `docker compose up -d`
- Referenced by: the app-image build in `deploy.yml`, root `docker-compose.yml`.

**To make Path B canonical:** delete `ecosystem.config.cjs`, remove the pm2
start/reload steps from deploy docs and `deploy.yml`, and fix the stale header
comment in `deploy.yml` that claims "app runs via pm2 / Docker hosts only
monitoring".

## The contradiction to resolve

| Signal                                                   | Says Path A (pm2) | Says Path B (Docker) |
| -------------------------------------------------------- | ----------------- | -------------------- |
| `.github/workflows/deploy.yml` header comment            | ✅                |                      |
| `.github/workflows/deploy.yml` build/push GHCR app image |                   | ✅                   |
| root `docker-compose.yml` app services                   |                   | ✅                   |
| `ecosystem.config.cjs`                                   | ✅                |                      |
| `PRODUCTION_CHECKLIST.md` / scaling steering             | ✅                |                      |

Until this is decided, treat **Path A (PM2)** as the documented default (it's
what the checklist and runbook lead with) and do **not** also start the app
containers from the root compose.

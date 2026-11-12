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

## Which file belongs to which path (#3272)

The decision above only helps if a new operator can tell which file belongs to
the host they are standing on. The two paths share the data tier; they do not
share the app, its edge, its environment or its scheduler.

| Concern           | Path A — production (pm2)                                                                                                                                                                                 | Path B — development (compose)                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| App process       | `ecosystem.config.cjs` (`web` = `next start`; `worker`, `cron`, `realtime` are separate apps)                                                                                                             | root `docker-compose.yml` (`web` = `nucrm-app`; `worker`; `realtime`) |
| App port          | 3099 or 3000, whichever the pm2 app binds; `deploy.yml` probes both                                                                                                                                       | 3000 inside the container (`PORT=3000`)                               |
| Edge              | `nucrm-nginx` from `deploy/docker-compose.production.yml`; `app`/`realtime` must resolve to the host gateway for the PM2 processes (see #3263). A host nginx must reproduce the same upstreams and ports. | direct to the `web` container; the root compose has no nginx service  |
| App env           | pm2's captured environment (`ecosystem.config.cjs` `env:` + `.env.local`); `pm2 reload --update-env` after a change                                                                                       | compose `environment:` / `env_file` / root `.env`                     |
| Deploy            | `.github/workflows/deploy.yml`: checkout the CI-tested SHA, `npm ci`, build, pm2 reload, health gate                                                                                                      | `docker compose up -d --build` (local only)                           |
| Scheduler         | host crontab `deploy/cron/crontab` **or** the pm2 `cron` app — never both                                                                                                                                 | the compose `cron` service / `scripts/cron-scheduler.ts`              |
| Health gate       | `127.0.0.1:3099/api/health` or `:3000`, as `deploy.yml` probes                                                                                                                                            | `http://app:3000/api/health` inside the compose network               |
| Data + monitoring | `deploy/docker-compose.production.yml` (Postgres, Redis, MinIO, Prometheus, Grafana, Loki)                                                                                                                | the root compose, for a full local stack                              |

`npm run prod:preflight` asks the host which path it is running before it reads
an environment (`--auto-source`, #3272): pm2 on Path A, the app container on
Path B, and a hard stop if both are running.

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

**Path A is canonical.** The remaining cleanup is the root
`docker-compose.yml`: it is the development path, not a production fallback, and
its `web`/`worker` services must not be started on the production host. The
monitoring compose and the pm2 reload step stay in `deploy.yml`.

## Path B — Docker Compose (development only)

The root `docker-compose.yml` runs the app + worker + infra as containers. It is
the local development stack; **it is not a production model** (see the decision
at the top). The production Compose file
`deploy/docker-compose.production.yml` is still used on Path A, but only for the
data/monitoring services — its `app`, `worker` and `cron` services are Path B
rows and must not be started on the production host.

- App services: `docker-compose.yml` → `web` (`nucrm-app`), `worker`,
  `realtime`
- Updates: `docker compose up -d --build`
- Env: compose `environment:` / root `.env`
- The old GHCR app-image rollout was removed from
  `.github/workflows/deploy.yml` (#1425); the workflow is a git-based pm2 update
  now.

## Historical evidence — resolved (#3272)

The table below is what the tree looked like before the decision at the top was
written down. It is kept so the next reader can see why both readings were
defensible; it is not a live question.

| Signal                                                   | Says Path A (pm2) | Says Path B (Docker)  |
| -------------------------------------------------------- | ----------------- | --------------------- |
| `.github/workflows/deploy.yml` header comment            | ✅                |                       |
| `.github/workflows/deploy.yml` build/push GHCR app image |                   | ✅ (removed, #1425)   |
| root `docker-compose.yml` app services                   |                   | ✅ (development only) |
| `ecosystem.config.cjs`                                   | ✅                |                       |
| `PRODUCTION_CHECKLIST.md` / scaling steering             | ✅                |                       |

`deploy.yml` now states Path A in its header and no longer builds or pushes a
GHCR app image, so the two strongest Path B signals above are gone. The
remaining Path B files are development-only.

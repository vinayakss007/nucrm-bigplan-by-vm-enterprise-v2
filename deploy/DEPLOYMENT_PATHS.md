# Deployment Paths — read this before deploying (#1425)

The repo currently ships **two** ways to run the application, and they overlap.
A new operator cannot tell which is canonical, and **running both binds port
3000 twice**. Pick ONE per environment.

> ⚠️ This is an owner decision. This doc describes the two paths and the exact
> files to keep/remove for each so the choice is unambiguous and reversible.

## Path A — PM2 on the VM (git-based updates)

The app + worker (+ optional cron) run as PM2 processes directly on the host;
Docker is used **only for the monitoring stack**.

- Config: `ecosystem.config.cjs` (the single canonical PM2 config — #1424)
- Start: `pm2 start ecosystem.config.cjs`
- Updates: `git pull && npm ci && npm run build && pm2 reload ecosystem.config.cjs`
- Monitoring: `docker compose -f deploy/docker-compose.production.yml up -d`
  (Prometheus/Grafana/Loki only)
- Cron: host crontab (`deploy/cron/crontab`) **or** the PM2 `cron` app — never both.
- Referenced by: `PRODUCTION_CHECKLIST.md`, `.kiro/steering/scaling-strategy.md`,
  `docs/planning/MAINTENANCE_UPDATE_GUIDE.md`.

**To make Path A canonical:** remove the `nucrm-enterprise-web` and
`nucrm-enterprise-worker` services from the root `docker-compose.yml`, and stop
building/pushing the GHCR app image in `.github/workflows/deploy.yml` (keep the
monitoring compose + the pm2 reload step).

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

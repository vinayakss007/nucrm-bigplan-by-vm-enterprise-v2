#!/usr/bin/env bash
# #3263 — point the Docker edge at the PM2 app.
#
# The compose topology resolves `app` and `realtime` through Docker's DNS: they
# are services in deploy/docker-compose.production.yml. On the PM2 topology
# (deploy/DEPLOYMENT_PATHS.md, Path A) the app and realtime are host processes
# started by ecosystem.config.cjs, so those names resolve to nothing inside
# nginx and Prometheus: the edge answers 502 and the `nucrm-app` scrape job
# produces no targets while the dashboards look healthy.
#
# This script applies deploy/docker-compose.pm2-edge.yml, which maps the names
# the configs already use to the host gateway, and then proves the edge can
# reach the host process before leaving it in place. It touches only nginx and
# prometheus (`--no-deps`), so it cannot start a second app on port 3000.
#
# Usage (on the PM2 host, from the repo root):
#   bash deploy/scripts/provision-pm2-edge.sh
#
# Env:
#   COMPOSE_PROJECT_NAME  optional — passed through to docker compose
#
# Revert to the compose topology with:
#   docker compose -f deploy/docker-compose.production.yml \
#     up -d --no-deps --force-recreate nginx prometheus
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

BASE=deploy/docker-compose.production.yml
OVERRIDE=deploy/docker-compose.pm2-edge.yml
NGINX_CONF=deploy/nginx/nginx-production.conf

command -v docker >/dev/null 2>&1 || { echo "[pm2-edge] docker is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "[pm2-edge] curl is required" >&2; exit 1; }
[ -f "$BASE" ] || { echo "[pm2-edge] missing $BASE" >&2; exit 1; }
[ -f "$OVERRIDE" ] || { echo "[pm2-edge] missing $OVERRIDE" >&2; exit 1; }
[ -f "$NGINX_CONF" ] || { echo "[pm2-edge] missing $NGINX_CONF" >&2; exit 1; }

# 1. Refuse the compose topology. `extra_hosts` wins over Docker DNS, so if the
#    compose app service is running, `app` must keep resolving to the container.
if [ -n "$(docker compose -f "$BASE" ps -q app 2>/dev/null || true)" ]; then
  echo "[pm2-edge] refusing: the compose 'app' service is running." >&2
  echo "[pm2-edge] This override is for the PM2 topology (Path A). In the compose" >&2
  echo "[pm2-edge] topology 'app' must keep resolving to the container." >&2
  exit 1
fi

# 2. Read the upstream ports from nginx, so the reachability check cannot drift
#    from the config the edge will actually serve.
APP_PORT="$(sed -n 's/.*server app:\([0-9][0-9]*\).*/\1/p' "$NGINX_CONF" | head -1)"
RT_PORT="$(sed -n 's/.*server realtime:\([0-9][0-9]*\).*/\1/p' "$NGINX_CONF" | head -1)"
if [ -z "$APP_PORT" ] || [ -z "$RT_PORT" ]; then
  echo "[pm2-edge] could not read the app/realtime ports from $NGINX_CONF" >&2
  exit 1
fi

# 3. The host process must be healthy on the port the upstream names. This is
#    necessary but not sufficient: a PM2 app bound to 127.0.0.1 passes this and
#    is still invisible to the bridge, which is why step 5 probes from inside
#    the container.
if ! curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
  echo "[pm2-edge] refusing: nothing healthy on 127.0.0.1:${APP_PORT}/api/health." >&2
  echo "[pm2-edge] Start the PM2 app first (pm2 start ecosystem.config.cjs --only web)." >&2
  exit 1
fi
if ! (exec 3<>"/dev/tcp/127.0.0.1/${RT_PORT}") 2>/dev/null; then
  echo "[pm2-edge] refusing: nothing listening on 127.0.0.1:${RT_PORT} (realtime)." >&2
  exit 1
fi

# 4. Recreate only the edge and the scraper with the alias override. --no-deps
#    is what keeps `depends_on: app` from starting the compose app service.
echo "[pm2-edge] applying $OVERRIDE to nginx and prometheus"
docker compose -f "$BASE" -f "$OVERRIDE" up -d --no-deps --force-recreate nginx prometheus

# 5. Prove it from inside the containers, not from the host: the alias, the
#    config, and an actual request through the same name the upstream uses.
GW="$(docker exec nucrm-nginx getent hosts app 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -z "$GW" ]; then
  echo "[pm2-edge] nginx cannot resolve 'app' — the override did not apply" >&2
  exit 1
fi
docker exec nucrm-nginx nginx -t
if ! docker exec nucrm-nginx wget -qO- -T 5 "http://app:${APP_PORT}/api/health" >/dev/null 2>&1; then
  echo "[pm2-edge] nginx resolves app -> ${GW} but cannot reach http://app:${APP_PORT}/api/health." >&2
  echo "[pm2-edge] Bind the PM2 app to an address the bridge can reach — NUCRM_HOST=0.0.0.0" >&2
  echo "[pm2-edge] (or the gateway address) in ecosystem.config.cjs — then pm2 reload --update-env." >&2
  exit 1
fi

echo "[pm2-edge] OK — nginx resolves app -> ${GW} and reached http://app:${APP_PORT}/api/health."
echo "[pm2-edge] Prometheus uses the same alias for the nucrm-app job; check Status → Targets."
echo "[pm2-edge] Revert with: docker compose -f $BASE up -d --no-deps --force-recreate nginx prometheus"

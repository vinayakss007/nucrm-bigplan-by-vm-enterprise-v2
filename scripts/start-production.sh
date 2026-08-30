#!/usr/bin/env bash
set -euo pipefail

# NuCRM Production Start Script
# Usage: bash scripts/start-production.sh [port]
# Default port: 3000

PORT="${1:-3000}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "=== NuCRM Production Launch ==="
echo "Port: $PORT"
echo "Node: $(node -v)"
echo "Dir:  $APP_DIR"

# --- Environment ---
export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-127.0.0.1}"

# --- Memory Limits ---
# Limit Node heap to 2GB to avoid OOM on 4GB machines
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=2048"

# --- Preflight: fail fast if anything critical is missing/unreachable ---
# Validates env + secrets + DB reachability + migrations + TLS + Redis + email
# + off-site backup storage. Refuses to start on a hard failure so the app
# never boots half-broken. Set PREFLIGHT_SKIP=true only for emergency overrides.
if [ "${PREFLIGHT_SKIP:-false}" != "true" ]; then
  echo "Running startup preflight..."
  if ! npx tsx scripts/preflight.ts; then
    echo "Cannot start: preflight failed (see above). Fix the blockers or set PREFLIGHT_SKIP=true to override."
    exit 1
  fi
else
  echo "WARNING: PREFLIGHT_SKIP=true — skipping startup checks."
fi

# --- Check if build exists ---
if [ ! -d ".next" ]; then
  echo "No .next directory found. Running build..."
  npm run build
fi

# --- Start Next.js ---
echo "Starting Next.js on $HOST:$PORT ..."
exec npx next start -H "$HOST" -p "$PORT"

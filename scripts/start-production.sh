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

# --- Ensure required env vars ---
MISSING=0
for var in DATABASE_URL JWT_SECRET SESSION_SECRET NEXT_PUBLIC_APP_URL; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    MISSING=1
  fi
done
if [ "$MISSING" = "1" ]; then
  echo "Cannot start: missing required environment variables. Check .env.local"
  exit 1
fi

# --- Check if build exists ---
if [ ! -d ".next" ]; then
  echo "No .next directory found. Running build..."
  npm run build
fi

# --- Start Next.js ---
echo "Starting Next.js on $HOST:$PORT ..."
exec npx next start -H "$HOST" -p "$PORT"

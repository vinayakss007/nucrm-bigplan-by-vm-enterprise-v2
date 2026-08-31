#!/usr/bin/env bash
# Start the realtime (socket.io) server with env from .env.local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# This script lives in scripts/; run everything from the repo root.
cd "$SCRIPT_DIR/.."

# Source .env.local to get REDIS_URL, DATABASE_URL, JWT_SECRET, etc.
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

exec node --import tsx realtime.ts

#!/bin/bash
# This script lives in scripts/; run from the repo root so npm/node_modules resolve.
cd "$(cd "$(dirname "$0")" && pwd)/.."
source ~/.nvm/nvm.sh
nvm use 22.22.2
export DATABASE_URL=${DATABASE_URL:?DATABASE_URL is not set. Source .env first: source .env}
export NEXT_PUBLIC_APP_URL=http://localhost:3000
export NODE_OPTIONS="--max-old-space-size=2048"

# Install concurrently if missing
if [ ! -f node_modules/.bin/concurrently ]; then
  npm install concurrently --no-save
fi

# Start app and worker in background
npm run dev:all > app.log 2>&1 &
APP_PID=$!

# Start ngrok
/teamspace/studios/this_studio/bin/ngrok http 3000 --log=stdout > /tmp/ngrok_nucrm.log 2>&1 &
NGROK_PID=$!

echo "Processes started. App PID: $APP_PID, ngrok PID: $NGROK_PID"
sleep 10
curl -s http://127.0.0.1:4040/api/tunnels

#!/bin/bash
source ~/.nvm/nvm.sh
nvm use 22.22.2
export DATABASE_URL=postgresql://postgres:nucrm_pass_2026@localhost:5432/nucrm
export NEXT_PUBLIC_APP_URL=http://localhost:3000

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

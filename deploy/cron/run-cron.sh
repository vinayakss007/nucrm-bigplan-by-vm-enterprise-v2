#!/bin/sh
# NuCRM — Cron job runner (calls app API with secret header)
JOB="$1"
APP_URL="${APP_URL:-http://app:3000}"
wget -q -O /dev/null --header="x-cron-secret: ${CRON_SECRET}" \
  --post-data="" "${APP_URL}/api/cron/${JOB}" 2>&1 || \
  echo "[$(date)] CRON FAILED: ${JOB}" >&2

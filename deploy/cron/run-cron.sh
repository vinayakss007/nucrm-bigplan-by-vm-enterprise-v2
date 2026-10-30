#!/bin/sh
# NuCRM — Cron job runner (calls app API with secret header)
JOB="$1"
APP_URL="${APP_URL:-http://app:3000}"

# #3298: every cron route now verifies x-cron-signature when CRON_SIGNING_KEY is set,
# so this caller has to produce it. The signed payload is the empty string — that is
# what --post-data="" sends, and no cron route reads a body. lib/cron/signature.ts is
# the Node side of the same recipe; tests/unit/cron-auth-uniform-3298.test.ts pins the
# two digests equal, because a scheduler that signs differently fails closed silently.
if [ -n "${CRON_SIGNING_KEY:-}" ]; then
  SIG=$(printf '' | openssl dgst -sha256 -hmac "$CRON_SIGNING_KEY" 2>/dev/null | awk '{print $NF}')
  if [ -z "$SIG" ]; then
    # Refuse to fire unsigned rather than 401 against every route and hide it in one
    # log line: that failure would read exactly like a wrong secret.
    echo "[$(date)] CRON NOT FIRED: ${JOB} — CRON_SIGNING_KEY is set but openssl dgst produced no signature (is openssl installed?)" >&2
    exit 1
  fi
  wget -q -O /dev/null \
    --header="x-cron-secret: ${CRON_SECRET}" \
    --header="x-cron-signature: sha256=${SIG}" \
    --post-data="" "${APP_URL}/api/cron/${JOB}" 2>&1 || \
    echo "[$(date)] CRON FAILED: ${JOB}" >&2
else
  wget -q -O /dev/null --header="x-cron-secret: ${CRON_SECRET}" \
    --post-data="" "${APP_URL}/api/cron/${JOB}" 2>&1 || \
    echo "[$(date)] CRON FAILED: ${JOB}" >&2
fi

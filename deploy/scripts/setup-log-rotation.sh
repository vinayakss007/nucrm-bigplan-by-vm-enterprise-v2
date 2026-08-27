#!/usr/bin/env bash
#
# NuCRM — PM2 log rotation setup  [#1043]
#
# Without rotation, PM2 (and the app/worker/cron logs it manages) grow
# unbounded and eventually fill the disk. This installs and configures the
# pm2-logrotate module. Idempotent: safe to run repeatedly (pm2 install is a
# no-op if already present, pm2 set just overwrites the values).
#
# Also (optionally) drops a native logrotate policy for logs written outside
# PM2's own log dir (e.g. NUCRM_LOG_DIR / /var/log/nucrm) so those rotate too.
#
# Usage (on the VM, as the user that runs PM2):
#   bash deploy/scripts/setup-log-rotation.sh
#
# Tunables (env):
#   PM2_LOG_MAX_SIZE   size before rotation      (default: 10M)
#   PM2_LOG_RETAIN     rotated files to keep     (default: 7)
#   PM2_LOG_COMPRESS   gzip rotated logs         (default: true)
#   NUCRM_LOG_DIR      app log dir for OS logrotate (default: none — skipped)
#
set -euo pipefail

MAX_SIZE="${PM2_LOG_MAX_SIZE:-10M}"
RETAIN="${PM2_LOG_RETAIN:-7}"
COMPRESS="${PM2_LOG_COMPRESS:-true}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found on PATH. Install it first: npm i -g pm2" >&2
  exit 1
fi

echo "==> Installing pm2-logrotate (no-op if already installed)..."
pm2 install pm2-logrotate

echo "==> Configuring rotation policy..."
pm2 set pm2-logrotate:max_size "${MAX_SIZE}"
pm2 set pm2-logrotate:retain "${RETAIN}"
pm2 set pm2-logrotate:compress "${COMPRESS}"
# Rotate at 00:00 daily in addition to the size trigger, and keep a stable
# worker rotation interval so long-idle processes still rotate.
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:workerInterval 30

echo "==> Current pm2-logrotate settings:"
pm2 conf pm2-logrotate 2>/dev/null | grep -E 'max_size|retain|compress|rotateInterval|workerInterval' || true

# ── Optional: native logrotate for app logs written outside PM2 ──────────────
# ecosystem.config.cjs writes to NUCRM_LOG_DIR (default ./logs). pm2-logrotate
# only rotates PM2's own out/error files; if you point logs elsewhere, add an
# OS logrotate policy too.
if [[ -n "${NUCRM_LOG_DIR:-}" ]]; then
  POLICY="/etc/logrotate.d/nucrm"
  if [[ -w /etc/logrotate.d || "${EUID}" -eq 0 ]]; then
    echo "==> Writing OS logrotate policy at ${POLICY} for ${NUCRM_LOG_DIR}..."
    cat > "${POLICY}" <<EOF
${NUCRM_LOG_DIR}/*.log {
    daily
    rotate ${RETAIN}
    size ${MAX_SIZE}
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
}
EOF
    echo "    Wrote ${POLICY}"
  else
    echo "==> Skipping OS logrotate policy (need root to write /etc/logrotate.d)."
    echo "    Re-run with sudo, or add this policy manually:"
    echo "    ${NUCRM_LOG_DIR}/*.log { daily rotate ${RETAIN} size ${MAX_SIZE} compress copytruncate missingok notifempty }"
  fi
fi

echo
echo "Done. PM2 logs now rotate at ${MAX_SIZE}, keeping ${RETAIN} compressed=${COMPRESS}."
echo "Verify:  pm2 conf pm2-logrotate"

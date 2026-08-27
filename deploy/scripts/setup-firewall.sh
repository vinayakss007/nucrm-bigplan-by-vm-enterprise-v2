#!/usr/bin/env bash
#
# NuCRM — Host firewall setup (UFW)  [#1036 / #1042]
#
# Makes the VM's public attack surface exactly three ports: SSH, HTTP, HTTPS.
# Everything else (Postgres 5432, Redis 6379, MinIO 9000/9001, Prometheus 9090,
# Grafana 3001, Loki 3100, Alertmanager 9093, the Next.js app port, the worker)
# stays reachable ONLY on the loopback / private Docker network, because
# docker-compose.production.yml binds them to 127.0.0.1. This script is the
# host-level backstop for that.
#
# Idempotent: safe to run repeatedly. Reads the SSH port from sshd_config so a
# non-default SSH port is not locked out.
#
# Usage (as root on the VM):
#   sudo bash deploy/scripts/setup-firewall.sh
#   sudo bash deploy/scripts/setup-firewall.sh --ssh-port 2222   # override
#
set -euo pipefail

SSH_PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script must run as root (use sudo)." >&2
  exit 1
fi

# Detect the active SSH port so we never lock ourselves out.
if [[ -z "${SSH_PORT}" ]]; then
  SSH_PORT="$(grep -E '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1 || true)"
  SSH_PORT="${SSH_PORT:-22}"
fi
echo "==> Using SSH port: ${SSH_PORT}"

# Install UFW if missing.
if ! command -v ufw >/dev/null 2>&1; then
  echo "==> Installing ufw..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y ufw
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ufw
  else
    echo "No supported package manager found to install ufw. Install it manually and re-run." >&2
    exit 1
  fi
fi

echo "==> Setting default policies (deny incoming, allow outgoing)..."
ufw default deny incoming
ufw default allow outgoing

echo "==> Allowing the three public ports only..."
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp   comment 'HTTP (redirects to HTTPS)'
ufw allow 443/tcp  comment 'HTTPS'

# Explicitly ensure the internal service ports are NOT publicly allowed. These
# should already be private (bound to 127.0.0.1 by compose), but we deny at the
# host edge as defence-in-depth in case a container is ever mis-bound.
for port in 5432 6379 9000 9001 9090 3001 3100 9093; do
  ufw delete allow "${port}/tcp" >/dev/null 2>&1 || true
done

echo "==> Enabling UFW..."
ufw --force enable

echo "==> Reloading..."
ufw reload

echo
echo "==> Current firewall status:"
ufw status verbose

echo
echo "Done. Public surface = ${SSH_PORT}(SSH), 80(HTTP), 443(HTTPS)."
echo "Verify from OUTSIDE the VM that 5432/6379/9000/9090/3001 are refused/filtered:"
echo "  nmap -Pn -p 22,80,443,5432,6379,9000,9090,3001 <VM_PUBLIC_IP>"

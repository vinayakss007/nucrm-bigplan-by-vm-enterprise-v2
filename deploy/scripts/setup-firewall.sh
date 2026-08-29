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
# It also hardens Docker's DOCKER-USER iptables chain so a container that is
# accidentally published on 0.0.0.0 cannot bypass UFW (Docker normally does).
#
# Usage (as root on the VM):
#   sudo bash deploy/scripts/setup-firewall.sh
#   sudo bash deploy/scripts/setup-firewall.sh --ssh-port 2222   # override SSH port
#   sudo bash deploy/scripts/setup-firewall.sh --iface ens3      # external NIC (default eth0)
#
# Verify from OUTSIDE the VM (no root needed):
#   bash deploy/scripts/setup-firewall.sh --verify <VM_PUBLIC_IP>
#
set -euo pipefail

SSH_PORT=""
PUBLIC_IFACE="${PUBLIC_IFACE:-eth0}"
VERIFY_HOST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --iface)    PUBLIC_IFACE="$2"; shift 2 ;;
    --verify)   VERIFY_HOST="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Verify mode: probe internal ports from an external vantage point ──────────
# Does not require root. Confirms only 22/80/443 answer and every internal port
# is refused/filtered. Run this from OUTSIDE the VM against its public IP.
if [[ -n "${VERIFY_HOST}" ]]; then
  echo "==> Verifying public surface of ${VERIFY_HOST} ..."
  PUBLIC_PORTS=(22 80 443)
  INTERNAL_PORTS=(5432 6432 6379 9000 9001 9090 3001 3100 9093 9100 9121 9187 4001 3000)
  fail=0
  probe() { # $1=port  → prints open/closed using bash /dev/tcp with a 3s timeout
    if timeout 3 bash -c ">/dev/tcp/${VERIFY_HOST}/$1" 2>/dev/null; then echo open; else echo closed; fi
  }
  for p in "${PUBLIC_PORTS[@]}"; do
    s="$(probe "$p")"; printf "  public   %-5s %s\n" "$p" "$s"
  done
  for p in "${INTERNAL_PORTS[@]}"; do
    s="$(probe "$p")"
    printf "  internal %-5s %s\n" "$p" "$s"
    [[ "$s" == "open" ]] && { echo "    ✗ PORT $p IS EXPOSED — fix the binding/firewall!"; fail=1; }
  done
  if [[ "$fail" -eq 0 ]]; then
    echo "==> PASS: no internal ports reachable from outside."
  else
    echo "==> FAIL: one or more internal ports are publicly reachable." >&2
  fi
  exit "$fail"
fi

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
#   5432 postgres · 6432 pgbouncer · 6379 redis · 9000/9001 minio ·
#   9090 prometheus · 3001 grafana · 3100 loki · 9093 alertmanager ·
#   9100 node-exporter · 9121 redis-exporter · 9187 postgres-exporter ·
#   4001 realtime · 3000 app
for port in 5432 6432 6379 9000 9001 9090 3001 3100 9093 9100 9121 9187 4001 3000; do
  ufw delete allow "${port}/tcp" >/dev/null 2>&1 || true
done

# ── Docker ↔ UFW bypass hardening ─────────────────────────────────────────────
# Docker writes its own iptables rules in the DOCKER-USER chain and, for ports
# published on 0.0.0.0, punches through UFW entirely (UFW never sees them). Our
# compose files bind internal services to 127.0.0.1 so they are not published on
# 0.0.0.0 — but if one is ever mis-bound, UFW alone would NOT protect it.
# Enable Docker to respect the host firewall by only accepting NEW external
# connections to the published web ports; everything else routed into containers
# from outside is dropped in DOCKER-USER (established/related still flow).
if command -v iptables >/dev/null 2>&1 && iptables -L DOCKER-USER >/dev/null 2>&1; then
  echo "==> Hardening the Docker DOCKER-USER chain (edge drop for non-web ports)..."
  # Idempotent: flush our managed rules, then re-add. We only allow inbound to
  # 80/443 from the outside; loopback and inter-container traffic are untouched.
  iptables -F DOCKER-USER
  iptables -A DOCKER-USER -i lo -j RETURN
  # Allow replies to connections the host initiated.
  iptables -A DOCKER-USER -m state --state RELATED,ESTABLISHED -j RETURN
  # Allow new inbound only to the public web ports (nginx).
  iptables -A DOCKER-USER -p tcp --dport 80  -j RETURN
  iptables -A DOCKER-USER -p tcp --dport 443 -j RETURN
  # Allow traffic that is NOT arriving from a real external interface (e.g. the
  # docker bridges / private nets) so containers can still talk to each other.
  iptables -A DOCKER-USER ! -i "${PUBLIC_IFACE:-eth0}" -j RETURN
  # Drop everything else destined for containers from the public interface.
  iptables -A DOCKER-USER -j DROP
  echo "    (set PUBLIC_IFACE if your external NIC is not eth0)"
else
  echo "==> NOTE: DOCKER-USER chain not found (Docker not running yet?)."
  echo "    Re-run this script AFTER Docker starts to apply the bypass hardening,"
  echo "    or rely on the 127.0.0.1 bindings in docker-compose.production.yml."
fi

echo "==> Enabling UFW..."
ufw --force enable

echo "==> Reloading..."
ufw reload

echo
echo "==> Current firewall status:"
ufw status verbose

echo
echo "Done. Public surface = ${SSH_PORT}(SSH), 80(HTTP), 443(HTTPS)."
echo "Verify from OUTSIDE the VM (all internal ports must be refused/filtered):"
echo "  bash deploy/scripts/setup-firewall.sh --verify <VM_PUBLIC_IP>"
echo "  # or: nmap -Pn -p 22,80,443,5432,6379,9000,9090,3001,9187 <VM_PUBLIC_IP>"

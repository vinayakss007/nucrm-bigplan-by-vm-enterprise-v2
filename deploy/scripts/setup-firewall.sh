#!/usr/bin/env bash
#
# NuCRM — Host firewall setup (UFW or firewalld)  [#1036 / #1042]
#
# Makes the VM's public attack surface exactly three ports: SSH, HTTP, HTTPS.
# Everything else (Postgres 5432, Redis 6379, MinIO 9000/9001, Prometheus 9090,
# Grafana 3001, Loki 3100, Alertmanager 9093, the Next.js app port, the worker)
# stays reachable ONLY on the loopback / private Docker network, because
# docker-compose.production.yml binds them to 127.0.0.1. This script is the
# host-level backstop for that.
#
# Two backends, because the host decides which one exists:
#   - firewalld is the default on RHEL / Oracle Linux / Fedora. UFW is not in
#     their base repositories, so a UFW-only script fails at `dnf install ufw`
#     and leaves the host exactly as exposed as it found it.
#   - UFW is the default on Debian / Ubuntu.
# `--backend auto` (the default) picks whichever firewall is already running,
# then whichever is installed, then the platform default. The two cannot run
# at the same time, so the script never installs one over the other silently.
#
# Idempotent: safe to run repeatedly. Reads the SSH port from sshd_config so a
# non-default SSH port is not locked out. Discovers the external NIC from the
# default route, so the Docker bypass hardening cannot silently no-op on a host
# whose NIC is not `eth0` (Oracle Cloud uses `enp0s5`, for example).
#
# It also hardens Docker's DOCKER-USER iptables chain so a container that is
# accidentally published on 0.0.0.0 cannot bypass the host firewall (Docker
# normally does).
#
# Usage (as root on the VM):
#   sudo bash deploy/scripts/setup-firewall.sh
#   sudo bash deploy/scripts/setup-firewall.sh --ssh-port 2222   # override SSH port
#   sudo bash deploy/scripts/setup-firewall.sh --iface ens3      # override external NIC
#   sudo bash deploy/scripts/setup-firewall.sh --backend firewalld
#   sudo bash deploy/scripts/setup-firewall.sh --zone public     # firewalld zone
#   sudo bash deploy/scripts/setup-firewall.sh --dry-run         # print, change nothing
#
# Verify from OUTSIDE the VM (no root needed):
#   bash deploy/scripts/setup-firewall.sh --verify <VM_PUBLIC_IP>
#
set -euo pipefail

SSH_PORT=""
PUBLIC_IFACE="${PUBLIC_IFACE:-}"
FIREWALL_ZONE="${FIREWALL_ZONE:-}"
BACKEND="${FIREWALL_BACKEND:-auto}"
VERIFY_HOST=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --iface)    PUBLIC_IFACE="$2"; shift 2 ;;
    --backend)  BACKEND="$2"; shift 2 ;;
    --zone)     FIREWALL_ZONE="$2"; shift 2 ;;
    --verify)   VERIFY_HOST="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "${BACKEND}" in
  auto|ufw|firewalld) ;;
  *) echo "--backend must be auto, ufw or firewalld (got '${BACKEND}')." >&2; exit 2 ;;
esac

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

if [[ "${DRY_RUN}" -ne 1 && "${EUID}" -ne 0 ]]; then
  echo "This script must run as root (use sudo)." >&2
  exit 1
fi
if [[ "${DRY_RUN}" -eq 1 && "${EUID}" -ne 0 ]]; then
  # firewalld's D-Bus/polkit API refuses zone reads to a non-root caller, so a
  # non-root preview cannot see the current ports/services it is about to remove.
  echo "==> NOTE: --dry-run without root cannot read the live zone; run it under sudo to preview the actual removals." >&2
fi

# Run a mutating command, or print it under --dry-run. `--dry-run` exists so the
# exact rule set is reviewable before it can lock anyone out, and so the tests
# can assert on it without root or a disposable VM.
run() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# Read a firewalld fact without failing when firewalld is not installed (the
# auto backend can select it from the platform before the install runs).
fw_query() {
  if command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd "$@" 2>/dev/null || true
  fi
}

firewalld_running() {
  command -v firewall-cmd >/dev/null 2>&1 || return 1
  [[ "$(firewall-cmd --state 2>/dev/null || true)" == "running" ]]
}

ufw_running() {
  command -v ufw >/dev/null 2>&1 || return 1
  local out
  out="$(ufw status 2>/dev/null || true)"
  grep -qi '^Status: active' <<<"${out}"
}

# ── Detect the external interface from the default route ──────────────────────
# The DOCKER-USER rule `! -i <iface> -j RETURN` must name the real public NIC:
# if it names eth0 on a host whose NIC is enp0s5, every external packet takes
# that RETURN and the DROP below it is unreachable. `ip route` is authoritative;
# eth0 remains the last-resort default for hosts without iproute2.
if [[ -z "${PUBLIC_IFACE}" ]]; then
  PUBLIC_IFACE="$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}' || true)"
  PUBLIC_IFACE="${PUBLIC_IFACE:-eth0}"
fi

# ── Pick the backend ──────────────────────────────────────────────────────────
if [[ "${BACKEND}" == "auto" ]]; then
  if firewalld_running; then
    BACKEND=firewalld
  elif ufw_running; then
    BACKEND=ufw
  elif command -v firewall-cmd >/dev/null 2>&1 && ! command -v ufw >/dev/null 2>&1; then
    BACKEND=firewalld
  elif command -v ufw >/dev/null 2>&1 && ! command -v firewall-cmd >/dev/null 2>&1; then
    BACKEND=ufw
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    BACKEND=firewalld
  elif command -v apt-get >/dev/null 2>&1; then
    BACKEND=ufw
  else
    echo "No supported firewall or package manager found. Install firewalld or ufw and re-run." >&2
    exit 1
  fi
fi

echo "==> Firewall backend: ${BACKEND}"
echo "==> External interface: ${PUBLIC_IFACE}"

# Detect the active SSH port so we never lock ourselves out.
if [[ -z "${SSH_PORT}" ]]; then
  SSH_PORT="$(grep -E '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1 || true)"
  SSH_PORT="${SSH_PORT:-22}"
fi
echo "==> Using SSH port: ${SSH_PORT}"

install_firewalld() {
  command -v firewall-cmd >/dev/null 2>&1 && return 0
  echo "==> Installing firewalld..."
  if command -v dnf >/dev/null 2>&1; then
    run dnf install -y firewalld
  elif command -v yum >/dev/null 2>&1; then
    run yum install -y firewalld
  elif command -v apt-get >/dev/null 2>&1; then
    run apt-get update -y
    run apt-get install -y firewalld
  else
    echo "No supported package manager found to install firewalld." >&2
    exit 1
  fi
  run systemctl enable --now firewalld
}

install_ufw() {
  command -v ufw >/dev/null 2>&1 && return 0
  echo "==> Installing ufw..."
  if command -v apt-get >/dev/null 2>&1; then
    run apt-get update -y
    run apt-get install -y ufw
  elif command -v dnf >/dev/null 2>&1; then
    # UFW is not in the RHEL/Oracle Linux base repositories. This is an explicit
    # `--backend ufw`, so attempt it and let dnf name the missing package rather
    # than silently switching the operator to a firewall they did not choose.
    run dnf install -y ufw
  elif command -v yum >/dev/null 2>&1; then
    run yum install -y ufw
  else
    echo "No supported package manager found to install ufw." >&2
    exit 1
  fi
}

# Internal services that must never be opened at the host edge. They are already
# bound to 127.0.0.1 by the compose files; this is defence-in-depth.
INTERNAL_PORTS=(5432 6432 6379 9000 9001 9090 3001 3100 9093 9100 9121 9187 4001 3000)

apply_ufw() {
  echo "==> Setting UFW default policies (deny incoming, allow outgoing)..."
  run ufw default deny incoming
  run ufw default allow outgoing

  echo "==> Allowing the three public ports only..."
  run ufw allow "${SSH_PORT}/tcp" comment 'SSH'
  run ufw allow 80/tcp   comment 'HTTP (redirects to HTTPS)'
  run ufw allow 443/tcp  comment 'HTTPS'

  # Explicitly ensure the internal service ports are NOT publicly allowed.
  #   5432 postgres · 6432 pgbouncer · 6379 redis · 9000/9001 minio ·
  #   9090 prometheus · 3001 grafana · 3100 loki · 9093 alertmanager ·
  #   9100 node-exporter · 9121 redis-exporter · 9187 postgres-exporter ·
  #   4001 realtime · 3000 app
  for port in "${INTERNAL_PORTS[@]}"; do
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      run ufw delete allow "${port}/tcp"
    else
      ufw delete allow "${port}/tcp" >/dev/null 2>&1 || true
    fi
  done

  echo "==> Enabling UFW..."
  run ufw --force enable
  run ufw reload

  echo
  echo "==> Current firewall status:"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "    [dry-run] ufw status verbose"
  else
    ufw status verbose
  fi
}

apply_firewalld() {
  local zone="${1}"
  local target ports services rich p s

  if ! firewalld_running; then
    echo "==> Starting firewalld..."
    run systemctl enable --now firewalld
  fi

  echo "==> Using firewalld zone: ${zone}"
  target="$(fw_query --zone="${zone}" --get-target)"
  if [[ "${target}" == "ACCEPT" ]]; then
    # An ACCEPT target allows every packet the zone does not otherwise match,
    # so removing ports would change nothing. `default` rejects unmatched
    # traffic and is firewalld's normal public-zone target.
    echo "==> Zone target is ACCEPT (unmatched traffic allowed); setting it to default (reject unmatched)..."
    run firewall-cmd --permanent --zone="${zone}" --set-target=default
  fi

  # Remove every explicitly opened port. The allow-list below re-adds only the
  # SSH port when it is non-default; 80/443 are opened as named services.
  ports="$(fw_query --zone="${zone}" --list-ports)"
  for p in ${ports}; do
    echo "    removing port ${p}"
    run firewall-cmd --permanent --zone="${zone}" --remove-port="${p}" || true
  done

  # Remove every service outside the public allow-list. dhcpv6-client stays:
  # it accepts replies to this host's own DHCPv6 solicit and is not a listener.
  # rdp is Oracle Cloud's default and must not survive a "locked down" host.
  services="$(fw_query --zone="${zone}" --list-services)"
  for s in ${services}; do
    case "${s}" in
      ssh|http|https|dhcpv6-client) ;;
      *)
        echo "    removing service ${s}"
        run firewall-cmd --permanent --zone="${zone}" --remove-service="${s}" || true
        ;;
    esac
  done

  # Rich rules can open ports the loops above never see (and can outrank the
  # service/port allow-list). This script does not rewrite them: they are
  # operator intent, not defaults. Say so instead of reporting a clean host.
  rich="$(fw_query --zone="${zone}" --list-rich-rules)"
  if [[ -n "${rich}" ]]; then
    echo "==> WARNING: zone ${zone} has rich rules this script does not modify; review them for opened ports:" >&2
    printf '%s\n' "${rich}" >&2
  fi

  # The `ssh` service is port 22. A non-default SSH port is opened explicitly
  # and the service removed, so the public surface stays exactly one SSH port.
  if [[ "${SSH_PORT}" == "22" ]]; then
    run firewall-cmd --permanent --zone="${zone}" --add-service=ssh
  else
    run firewall-cmd --permanent --zone="${zone}" --remove-service=ssh || true
    run firewall-cmd --permanent --zone="${zone}" --add-port="${SSH_PORT}/tcp"
  fi
  run firewall-cmd --permanent --zone="${zone}" --add-service=http
  run firewall-cmd --permanent --zone="${zone}" --add-service=https

  echo "==> Reloading firewalld..."
  run firewall-cmd --reload

  echo
  echo "==> Current firewall status:"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "    [dry-run] firewall-cmd --zone=${zone} --list-all"
  else
    firewall-cmd --zone="${zone}" --list-all
  fi
}

# ── Docker ↔ host-firewall bypass hardening ───────────────────────────────────
# Docker writes its own iptables rules in the DOCKER-USER chain and, for ports
# published on 0.0.0.0, punches through both UFW and firewalld (neither sees the
# forwarded packet). Our compose files bind internal services to 127.0.0.1 so
# they are not published on 0.0.0.0 — but if one is ever mis-bound, the host
# firewall alone would NOT protect it. Allow NEW external connections only to
# the published web ports; everything else routed into containers from outside
# is dropped in DOCKER-USER (established/related still flow).
harden_docker() {
  if command -v iptables >/dev/null 2>&1 && iptables -L DOCKER-USER >/dev/null 2>&1; then
    echo "==> Hardening the Docker DOCKER-USER chain (edge drop for non-web ports)..."
    # Idempotent: flush our managed rules, then re-add. Loopback and
    # inter-container traffic are untouched.
    run iptables -F DOCKER-USER
    run iptables -A DOCKER-USER -i lo -j RETURN
    # Allow replies to connections the host initiated.
    run iptables -A DOCKER-USER -m state --state RELATED,ESTABLISHED -j RETURN
    # Allow new inbound only to the public web ports (nginx).
    run iptables -A DOCKER-USER -p tcp --dport 80  -j RETURN
    run iptables -A DOCKER-USER -p tcp --dport 443 -j RETURN
    # Allow traffic that is NOT arriving from the external interface (e.g. the
    # docker bridges / private nets) so containers can still talk to each other.
    run iptables -A DOCKER-USER ! -i "${PUBLIC_IFACE}" -j RETURN
    # Drop everything else destined for containers from the public interface.
    run iptables -A DOCKER-USER -j DROP
  else
    echo "==> NOTE: DOCKER-USER chain not found (Docker not running yet?)."
    echo "    Re-run this script AFTER Docker starts to apply the bypass hardening,"
    echo "    or rely on the 127.0.0.1 bindings in docker-compose.production.yml."
  fi
}

if [[ "${BACKEND}" == "firewalld" ]]; then
  install_firewalld
  if [[ -z "${FIREWALL_ZONE}" ]]; then
    FIREWALL_ZONE="$(fw_query --get-zone-of-interface="${PUBLIC_IFACE}")"
    if [[ -z "${FIREWALL_ZONE}" || "${FIREWALL_ZONE}" == "no zone" ]]; then
      FIREWALL_ZONE="$(fw_query --get-default-zone)"
    fi
    FIREWALL_ZONE="${FIREWALL_ZONE:-public}"
  fi
  apply_firewalld "${FIREWALL_ZONE}"
else
  install_ufw
  apply_ufw
fi

harden_docker

echo
echo "Done. Backend=${BACKEND}; public surface = ${SSH_PORT}(SSH), 80(HTTP), 443(HTTPS)."
echo "Verify from OUTSIDE the VM (all internal ports must be refused/filtered):"
echo "  bash deploy/scripts/setup-firewall.sh --verify <VM_PUBLIC_IP>"
echo "  # or: nmap -Pn -p 22,80,443,5432,6379,9000,9090,3001,9187 <VM_PUBLIC_IP>"

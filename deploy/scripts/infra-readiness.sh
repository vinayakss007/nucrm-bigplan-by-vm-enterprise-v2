#!/usr/bin/env bash
###############################################################################
#  NuCRM — Infrastructure Readiness Check (server-side preflight)
#
#  scripts/preflight.ts validates what the APP process needs (env, DB, migrations,
#  email, Redis). This script is its OPERATIONAL counterpart: it verifies the
#  VM/host-level launch items that live OUTSIDE the app process and that the app
#  cannot check for itself:
#
#    #1036  Firewall — only 22/80/443 public                (setup-firewall.sh)
#    #1040  Real domain + valid (non-self-signed) TLS        (setup-ssl.sh)
#    #1038  Database backups exist AND are scheduled         (backup.sh + crontab)
#    #1125  Secrets are real (rotated, not placeholders)     (generate-secrets.sh)
#    #1041  Email configured (Resend or SMTP)
#    #1039  Sentry enabled with a DSN
#    #1044  Monitoring stack running                          (--profile monitoring)
#
#  For every item it reports:  [ OK ] / [WARN] / [FAIL]  and, on anything less
#  than OK, the EXACT command to fix it. It never changes anything — it only
#  inspects — so it is safe to run repeatedly, before or after a deploy.
#
#  Usage (on the VM):
#    bash deploy/scripts/infra-readiness.sh                 # full check
#    bash deploy/scripts/infra-readiness.sh --public-ip 1.2.3.4   # also probe firewall from host
#    STRICT=1 bash deploy/scripts/infra-readiness.sh        # WARN => FAIL (CI/launch gate)
#
#  Exit codes: 0 = ready (warnings allowed), 1 = one or more hard failures.
#  In STRICT mode every warning is promoted to a failure.
###############################################################################
set -uo pipefail

# ── Locate repo root and load env ────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

STRICT="${STRICT:-0}"
PUBLIC_IP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-ip) PUBLIC_IP="$2"; shift 2 ;;
    --strict)    STRICT=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Load env from the first file that exists, without clobbering already-exported vars.
ENV_LOADED=""
for f in .env .env.local deploy/.env; do
  if [[ -f "$f" ]]; then
    set -a; # shellcheck disable=SC1090
    source "$f" 2>/dev/null || true; set +a
    ENV_LOADED="$f"
    break
  fi
done

# ── Output helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; WARN=0; FAIL=0
declare -a LINES

_ok()   { PASS=$((PASS+1)); LINES+=("$(printf "  [ ${GREEN}OK${NC}  ] %-22s %s" "$1" "$2")"); }
_warn() { WARN=$((WARN+1)); LINES+=("$(printf "  [${YELLOW}WARN${NC} ] %-22s %s" "$1" "$2")");
          [[ -n "${3:-}" ]] && LINES+=("$(printf "           ${CYAN}fix:${NC} %s" "$3")"); }
_fail() { FAIL=$((FAIL+1)); LINES+=("$(printf "  [${RED}FAIL${NC} ] %-22s %s" "$1" "$2")");
          [[ -n "${3:-}" ]] && LINES+=("$(printf "           ${CYAN}fix:${NC} %s" "$3")"); }

# WARN in dev, FAIL in production — for items that are launch blockers only.
IS_PROD=0
[[ "${NODE_ENV:-}" == "production" ]] && IS_PROD=1
_prodfail() { if [[ "$IS_PROD" -eq 1 ]]; then _fail "$1" "$2" "${3:-}"; else _warn "$1" "$2" "${3:-}"; fi; }

# Placeholder detection — mirrors PLACEHOLDER_SECRETS in scripts/preflight.ts.
is_placeholder() {
  local v="${1:-}"
  [[ -z "$v" ]] && return 0
  case "$v" in
    re_xxxxxx|your-access-key|your-secret-key|generate-a-random-password-here|\
    sk_test_xxxxxx|whsec_xxxxxx|changeme|placeholder|example|test|dev|todo) return 0 ;;
  esac
  # xxx, xxxx, ... (all-x placeholders)
  [[ "$v" =~ ^x+$ ]] && return 0
  return 1
}

# ── 1. Secrets rotated (#1125) ────────────────────────────────────────────────
check_secrets() {
  local weak=()
  for key in JWT_SECRET SESSION_SECRET CRON_SECRET ENCRYPTION_KEY; do
    local val="${!key:-}"
    if [[ -z "$val" ]]; then
      weak+=("$key(unset)")
    elif is_placeholder "$val"; then
      weak+=("$key(placeholder)")
    elif [[ "${#val}" -lt 16 ]]; then
      weak+=("$key(${#val}chars)")
    fi
  done
  if [[ ${#weak[@]} -eq 0 ]]; then
    _ok "secrets" "core secrets present and non-placeholder"
  else
    _fail "secrets" "weak/unset: ${weak[*]}" \
      "bash deploy/generate-secrets.sh   # then paste into .env and rotate"
  fi
}

# ── 2. Email configured (#1041) ───────────────────────────────────────────────
check_email() {
  local resend="${RESEND_API_KEY:-}" smtp="${SMTP_HOST:-}"
  if { [[ -n "$resend" ]] && ! is_placeholder "$resend"; } || [[ -n "$smtp" ]]; then
    _ok "email" "$( [[ -n "$resend" ]] && ! is_placeholder "$resend" && echo Resend || echo SMTP ) configured"
  else
    _prodfail "email" "no RESEND_API_KEY or SMTP_HOST — resets/invites/notifications will not send" \
      "set RESEND_API_KEY in .env (sign up at resend.com, verify sending domain)"
  fi
}

# ── 3. Sentry enabled (#1039) ─────────────────────────────────────────────────
check_sentry() {
  local dsn="${SENTRY_DSN:-${NEXT_PUBLIC_SENTRY_DSN:-}}"
  local disabled="${SENTRY_DISABLE:-false}"
  if [[ "$disabled" == "true" ]]; then
    _prodfail "sentry" "SENTRY_DISABLE=true — error tracking is OFF" \
      "set SENTRY_DISABLE=false and a real SENTRY_DSN in .env"
  elif [[ -z "$dsn" ]] || is_placeholder "$dsn" || [[ "$dsn" == *"xxx"* ]]; then
    _prodfail "sentry" "no valid SENTRY_DSN — errors go unreported" \
      "get a DSN from sentry.io and set SENTRY_DSN in .env"
  else
    _ok "sentry" "DSN set, tracking enabled"
  fi
}

# ── 4. Firewall — only 22/80/443 public (#1036) ───────────────────────────────
check_firewall() {
  # Preferred: probe from outside if a public IP was supplied.
  if [[ -n "$PUBLIC_IP" ]]; then
    local exposed=()
    for p in 5432 6379 9000 9090 3001 9187; do
      if timeout 3 bash -c ">/dev/tcp/${PUBLIC_IP}/$p" 2>/dev/null; then exposed+=("$p"); fi
    done
    if [[ ${#exposed[@]} -eq 0 ]]; then
      _ok "firewall" "no internal ports reachable on ${PUBLIC_IP}"
    else
      _fail "firewall" "internal ports OPEN on ${PUBLIC_IP}: ${exposed[*]}" \
        "sudo bash deploy/scripts/setup-firewall.sh"
    fi
    return
  fi
  # Fallback: inspect UFW status locally.
  if command -v ufw >/dev/null 2>&1; then
    local status; status="$(ufw status 2>/dev/null | head -1 || true)"
    if echo "$status" | grep -qi "Status: active"; then
      _ok "firewall" "ufw active (verify with --public-ip <IP> from outside)"
    else
      _prodfail "firewall" "ufw installed but NOT active — all ports may be public" \
        "sudo bash deploy/scripts/setup-firewall.sh"
    fi
  else
    _prodfail "firewall" "ufw not installed; cannot confirm the host is firewalled" \
      "sudo bash deploy/scripts/setup-firewall.sh   (or pass --public-ip <IP> to probe)"
  fi
}

# ── 5. TLS: real domain + valid cert (#1040) ──────────────────────────────────
check_tls() {
  local domain="${DOMAIN:-}"
  is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

  if [[ -z "$domain" ]]; then
    _prodfail "tls/domain" "DOMAIN unset — running on IP + self-signed cert (browser warnings)" \
      "set DOMAIN + ACME_EMAIL in .env, then: bash deploy/scripts/setup-ssl.sh"
    return
  fi
  if is_ip "$domain"; then
    _prodfail "tls/domain" "DOMAIN='${domain}' is an IP — Let's Encrypt can't issue for IPs" \
      "point a DNS name at this IP, set DOMAIN=that name, then run setup-ssl.sh"
    return
  fi
  # Real hostname: check the served certificate is not self-signed and not expired.
  if command -v openssl >/dev/null 2>&1; then
    local cert; cert="$(echo | timeout 8 openssl s_client -servername "$domain" -connect "${domain}:443" 2>/dev/null | openssl x509 -noout -issuer -checkend 0 2>/dev/null || true)"
    if [[ -z "$cert" ]]; then
      _prodfail "tls/domain" "could not retrieve a cert from ${domain}:443" \
        "ensure nginx is up on :443, then: bash deploy/scripts/setup-ssl.sh"
    elif echo "$cert" | grep -qi "O = NuCRM"; then
      _prodfail "tls/domain" "self-signed cert served for ${domain} (browsers will warn)" \
        "bash deploy/scripts/setup-ssl.sh   # issues a real Let's Encrypt cert"
    else
      _ok "tls/domain" "${domain} serves a valid CA-issued certificate"
    fi
  else
    _warn "tls/domain" "DOMAIN=${domain} set but openssl missing to verify the cert" \
      "install openssl, or verify manually: curl -sSf https://${domain}/health"
  fi
}

# ── 6. Backups exist AND are scheduled (#1038) ────────────────────────────────
check_backups() {
  local dir="${BACKUP_DIR:-/var/backups/nucrm}"
  local recent=""
  if [[ -d "$dir" ]]; then
    # newest .dump modified in the last 48h
    recent="$(find "$dir" -name 'nucrm_backup_*.dump' -mtime -2 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "$recent" ]]; then
    _ok "backups/recent" "recent dump in ${dir}"
  else
    _prodfail "backups/recent" "no backup dump in ${dir} within 48h" \
      "bash deploy/scripts/backup.sh          # take one now (uploads to S3/MinIO)"
  fi

  # Scheduled? crontab must reference auto-backup or backup.sh, OR the cron container runs.
  local scheduled=0
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -Eq 'auto-backup|backup\.sh'; then
    scheduled=1
  elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'nucrm-cron'; then
    scheduled=1
  fi
  if [[ "$scheduled" -eq 1 ]]; then
    _ok "backups/schedule" "auto-backup scheduled (cron/container)"
  else
    _prodfail "backups/schedule" "no scheduled backup job found" \
      "install deploy/cron/crontab (line: 0 2 * * * ... auto-backup) or start the cron container"
  fi

  # Off-site storage configured so backups survive host loss.
  local bucket="${BACKUP_BUCKET:-${S3_BUCKET:-}}"
  local akey="${S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
  if [[ -n "$bucket" ]] && [[ -n "$akey" ]] && ! is_placeholder "$akey"; then
    _ok "backups/offsite" "off-site bucket '${bucket}' configured"
  else
    _prodfail "backups/offsite" "S3/R2 not configured — backups stay on host, lost if host dies" \
      "set S3_BUCKET/BACKUP_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY in .env"
  fi
}

# ── 7. Monitoring stack running (#1044) ───────────────────────────────────────
check_monitoring() {
  if ! command -v docker >/dev/null 2>&1; then
    _warn "monitoring" "docker not available to check the monitoring stack" \
      "docker compose --profile monitoring up -d"
    return
  fi
  local names; names="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  local up=() missing=()
  for svc in prometheus grafana; do
    if echo "$names" | grep -qi "$svc"; then up+=("$svc"); else missing+=("$svc"); fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    _ok "monitoring" "running: ${up[*]}"
  elif [[ ${#up[@]} -gt 0 ]]; then
    _prodfail "monitoring" "partial — up: ${up[*]}; missing: ${missing[*]}" \
      "docker compose --profile monitoring up -d"
  else
    _prodfail "monitoring" "monitoring stack not running" \
      "docker compose --profile monitoring up -d"
  fi
}

# ── Run all checks ────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  NuCRM — Infrastructure Readiness Check${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo "  NODE_ENV=${NODE_ENV:-unset}   env-file=${ENV_LOADED:-none}   $( [[ "$STRICT" == "1" ]] && echo STRICT )"
echo ""

check_secrets
check_email
check_sentry
check_firewall
check_tls
check_backups
check_monitoring

for l in "${LINES[@]}"; do echo -e "$l"; done

# In STRICT mode, promote warnings to hard failures.
HARD=$FAIL
[[ "$STRICT" == "1" ]] && HARD=$((FAIL + WARN))

echo ""
echo -e "  Summary: ${GREEN}${PASS} ok${NC}, ${YELLOW}${WARN} warn${NC}, ${RED}${FAIL} fail${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"

if [[ "$HARD" -gt 0 ]]; then
  echo -e "  ${RED}NOT READY${NC} — ${HARD} blocker(s). Fix the items above and re-run."
  exit 1
fi
echo -e "  ${GREEN}INFRASTRUCTURE READY${NC}$( [[ "$WARN" -gt 0 ]] && echo "  (with ${WARN} warning(s) — acceptable for non-production)" )"
exit 0

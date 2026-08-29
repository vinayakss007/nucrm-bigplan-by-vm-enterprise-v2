#!/usr/bin/env bash
###############################################################################
#  NuCRM — TLS certificate bootstrap for the public edge (nginx)   [#1040]
#
#  Replaces the "IP + self-signed" default with a real Let's Encrypt certificate
#  for your domain, and keeps a self-signed fallback for local / IP-only tests.
#
#  What it does
#  ------------
#    * Reads DOMAIN and ACME_EMAIL from ../.env.
#    * If DOMAIN is a real hostname (not empty, not an IP): obtains a Let's
#      Encrypt certificate via the http-01 webroot challenge, served by the
#      already-running nginx from the shared certbot-webroot volume.
#    * If DOMAIN is empty or an IP address: generates a self-signed certificate
#      so HTTPS still comes up (browsers will warn — expected for IP access).
#    * Maintains a stable symlink  live/nucrm -> live/<domain>  (or the
#      self-signed dir) that nginx-production.conf reads. Renewal keeps it fresh.
#
#  Usage (on the VM, after the stack is up so nginx can answer :80):
#    bash deploy/scripts/setup-ssl.sh                 # uses .env DOMAIN/ACME_EMAIL
#    DOMAIN=crm.acme.com ACME_EMAIL=ops@acme.com bash deploy/scripts/setup-ssl.sh
#    bash deploy/scripts/setup-ssl.sh --staging       # LE staging (no rate limit)
#    bash deploy/scripts/setup-ssl.sh --self-signed   # force self-signed
#
#  Re-run any time: it is idempotent and will not re-issue a valid cert.
###############################################################################
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.production.yml"
STAGING=""
FORCE_SELF_SIGNED=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging)     STAGING="--staging"; shift ;;
    --self-signed) FORCE_SELF_SIGNED="1"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Load DOMAIN / ACME_EMAIL from .env unless already exported.
if [[ -f ../.env ]]; then
  # shellcheck disable=SC1091
  set -a; source ../.env 2>/dev/null || true; set +a
fi
DOMAIN="${DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"

log() { echo "[SSL $(date +%H:%M:%S)] $*"; }

is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

# certbot and nginx share these two named volumes (see compose). We drive certbot
# via `docker compose run` so it uses the same volumes as the renewal container.
run_certbot() { $COMPOSE run --rm --entrypoint certbot certbot "$@"; }

# Point the stable live/nucrm symlink at $1 (a dir under /etc/letsencrypt/live).
link_live() {
  local target="$1"
  run_certbot -c "ln -sfn '/etc/letsencrypt/live/${target}' /etc/letsencrypt/live/nucrm" \
    >/dev/null 2>&1 || \
  $COMPOSE run --rm --entrypoint /bin/sh certbot -c \
    "ln -sfn '/etc/letsencrypt/live/${target}' /etc/letsencrypt/live/nucrm"
}

generate_self_signed() {
  log "Generating self-signed certificate (CN=${DOMAIN:-localhost})..."
  local cn="${DOMAIN:-localhost}"
  $COMPOSE run --rm --entrypoint /bin/sh certbot -c "
    set -e
    mkdir -p /etc/letsencrypt/live/self-signed
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout /etc/letsencrypt/live/self-signed/privkey.pem \
      -out    /etc/letsencrypt/live/self-signed/fullchain.pem \
      -subj '/CN=${cn}/O=NuCRM' >/dev/null 2>&1
    ln -sfn /etc/letsencrypt/live/self-signed /etc/letsencrypt/live/nucrm
  "
  log "Self-signed cert installed at live/nucrm. Browsers will warn (expected for IP access)."
}

issue_letsencrypt() {
  if [[ -z "$ACME_EMAIL" ]]; then
    echo "ACME_EMAIL is required to issue a Let's Encrypt certificate." >&2
    echo "Set ACME_EMAIL in .env or export it, then re-run." >&2
    exit 1
  fi
  log "Requesting Let's Encrypt certificate for ${DOMAIN} (email ${ACME_EMAIL})..."
  # http-01 via the webroot the running nginx serves at /.well-known/acme-challenge/
  run_certbot certonly \
    --webroot -w /var/www/certbot \
    -d "${DOMAIN}" \
    --email "${ACME_EMAIL}" \
    --agree-tos --no-eff-email \
    --non-interactive \
    --keep-until-expiring \
    ${STAGING}
  link_live "${DOMAIN}"
  log "Let's Encrypt certificate active at live/nucrm -> live/${DOMAIN}."
}

reload_nginx() {
  log "Reloading nginx to pick up the certificate..."
  $COMPOSE exec nginx nginx -s reload 2>/dev/null || \
    log "nginx not running yet — it will read the cert on next start."
}

# ── Main ─────────────────────────────────────────────────────────────────────
if [[ -n "$FORCE_SELF_SIGNED" ]]; then
  generate_self_signed
elif [[ -z "$DOMAIN" ]]; then
  log "DOMAIN is empty — no real domain configured. Using self-signed cert."
  log "Set DOMAIN + ACME_EMAIL in .env and re-run to get a real Let's Encrypt cert."
  generate_self_signed
elif is_ip "$DOMAIN"; then
  log "DOMAIN='${DOMAIN}' is an IP address. Let's Encrypt does not issue for IPs."
  log "Using self-signed cert. Point a real DNS name at this IP to enable HTTPS."
  generate_self_signed
else
  issue_letsencrypt
fi

reload_nginx

echo
log "Done. nginx serves TLS from /etc/letsencrypt/live/nucrm/."
log "Renewal is automatic: the certbot container runs 'certbot renew' every 12h"
log "and nginx reloads every 12h. Verify:  curl -sSf https://${DOMAIN:-localhost}/health"

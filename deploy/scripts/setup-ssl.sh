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
#      WITH a matching subjectAltName, so HTTPS comes up and the cert is valid
#      for that name/IP (#2592). Browsers still warn — the issuer is untrusted,
#      not the name — but a SAN-less cert was refused outright, which is the bug.
#    * Maintains a stable symlink  live/nucrm -> live/<domain>  (or the
#      self-signed dir) that nginx-production.conf reads. Renewal keeps it fresh.
#
#  Usage (on the VM, after the stack is up so nginx can answer :80):
#    bash deploy/scripts/setup-ssl.sh                 # uses .env DOMAIN/ACME_EMAIL
#    DOMAIN=crm.acme.com ACME_EMAIL=ops@acme.com bash deploy/scripts/setup-ssl.sh
#    bash deploy/scripts/setup-ssl.sh --staging       # LE staging (no rate limit)
#    bash deploy/scripts/setup-ssl.sh --self-signed   # force self-signed
#    bash deploy/scripts/setup-ssl.sh --issuer podman # no Docker daemon on this host
#    bash deploy/scripts/setup-ssl.sh --issuer openssl --self-signed
#
#  The issuer is who *runs* certbot/openssl, not who the certificate is for:
#    docker  (default) docker compose run against docker-compose.production.yml
#    podman            podman compose / podman-compose, same images + volumes
#    openssl           no container at all — use the host's certbot/openssl CLI
#                      (pm2 hosts, or a Podman host without compose support).
#  `SSL_DIR` (default /etc/letsencrypt) and `ACME_WEBROOT` (default
#  /var/www/certbot) are what the openssl issuer writes to and reads from.
#
#  Re-run any time: it is idempotent and will not re-issue a valid cert.
###############################################################################
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/self-signed-san.sh
. "${SCRIPT_DIR}/lib/self-signed-san.sh"
cd "${SCRIPT_DIR}/.."

COMPOSE=""
STAGING=""
FORCE_SELF_SIGNED=""
CERT_KIND=""
ENGINE="${SSL_ISSUER:-docker}"
SSL_DIR="${SSL_DIR:-/etc/letsencrypt}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/certbot}"

usage() {
  sed -n '2,40p' "${SCRIPT_DIR}/setup-ssl.sh" | sed 's/^#  \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging)     STAGING="--staging"; shift ;;
    --self-signed) FORCE_SELF_SIGNED="1"; shift ;;
    --issuer)      [[ $# -ge 2 ]] || { echo "--issuer needs docker|podman|openssl" >&2; exit 2; }
                   ENGINE="$2"; shift 2 ;;
    --issuer=*)    ENGINE="${1#*=}"; shift ;;
    --ssl-dir)     [[ $# -ge 2 ]] || { echo "--ssl-dir needs a path" >&2; exit 2; }
                   SSL_DIR="$2"; shift 2 ;;
    --acme-webroot) [[ $# -ge 2 ]] || { echo "--acme-webroot needs a path" >&2; exit 2; }
                   ACME_WEBROOT="$2"; shift 2 ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Decide who runs certbot/openssl. The container issuers need a compose command;
# openssl needs neither compose nor a daemon, which is the point of #3262.
configure_issuer() {
  case "$ENGINE" in
    docker)
      command -v docker >/dev/null 2>&1 || {
        echo "docker is not installed; use --issuer podman or --issuer openssl" >&2
        exit 2
      }
      COMPOSE="docker compose -f docker-compose.production.yml"
      ;;
    podman)
      command -v podman >/dev/null 2>&1 || {
        echo "podman is not installed; use --issuer docker or --issuer openssl" >&2
        exit 2
      }
      if podman compose version >/dev/null 2>&1; then
        COMPOSE="podman compose -f docker-compose.production.yml"
      elif command -v podman-compose >/dev/null 2>&1; then
        COMPOSE="podman-compose -f docker-compose.production.yml"
      else
        echo "podman has no compose provider; install podman-compose or use --issuer openssl" >&2
        exit 2
      fi
      ;;
    openssl)
      command -v openssl >/dev/null 2>&1 || {
        echo "openssl is not installed" >&2
        exit 2
      }
      ;;
    *)
      echo "Unknown issuer '${ENGINE}' — expected docker, podman or openssl" >&2
      exit 2
      ;;
  esac
}
configure_issuer

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
  if [[ "$ENGINE" == openssl ]]; then
    ln -sfn "${SSL_DIR}/live/${target}" "${SSL_DIR}/live/nucrm"
    return
  fi
  run_certbot -c "ln -sfn '/etc/letsencrypt/live/${target}' /etc/letsencrypt/live/nucrm" \
    >/dev/null 2>&1 || \
  $COMPOSE run --rm --entrypoint /bin/sh certbot -c \
    "ln -sfn '/etc/letsencrypt/live/${target}' /etc/letsencrypt/live/nucrm"
}

generate_self_signed() {
  if [[ "$ENGINE" == openssl ]]; then
    generate_self_signed_local
  else
    generate_self_signed_container
  fi
}

# Host path: no container, no daemon (#3262). Same SAN rule and same fail-loud
# verification as the container path — the trap was the missing SAN, not where
# openssl ran.
generate_self_signed_local() {
  local id="${DOMAIN:-localhost}"
  local san target="${SSL_DIR}/live/self-signed"
  san="$(compute_subject_alt_name "$id")"
  log "Generating self-signed certificate with the host openssl (CN=${id}, SAN=${san})..."
  umask 077
  mkdir -p "$target" "${SSL_DIR}/live"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$target/privkey.pem" \
    -out    "$target/fullchain.pem" \
    -subj "/CN=${id}/O=NuCRM" \
    -addext "subjectAltName=${san}" >/dev/null 2>&1
  if ! openssl x509 -in "$target/fullchain.pem" -noout -text \
       | grep -qE 'IP Address:|DNS:'; then
    echo 'ERROR: generated self-signed certificate carries no subjectAltName' >&2
    exit 3
  fi
  ln -sfn "$target" "${SSL_DIR}/live/nucrm"
  log "Self-signed cert installed at ${SSL_DIR}/live/nucrm with SAN=${san}."
  CERT_KIND="self-signed"
}

generate_self_signed_container() {
  local id="${DOMAIN:-localhost}"
  local san
  san="$(compute_subject_alt_name "$id")"
  log "Generating self-signed certificate (CN=${id}, SAN=${san})..."
  # -addext is mandatory: a CN-only cert is rejected by every browser (RFC 6125
  # §6.4.4), and we fail the whole script if the SAN did not make it into the
  # certificate rather than installing a cert that only curl's CN fallback likes.
  $COMPOSE run --rm --entrypoint /bin/sh certbot -c "
    set -e
    mkdir -p /etc/letsencrypt/live/self-signed
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout /etc/letsencrypt/live/self-signed/privkey.pem \
      -out    /etc/letsencrypt/live/self-signed/fullchain.pem \
      -subj '/CN=${id}/O=NuCRM' \
      -addext 'subjectAltName=${san}' >/dev/null 2>&1
    if ! openssl x509 -in /etc/letsencrypt/live/self-signed/fullchain.pem -noout -text \
         | grep -qE 'IP Address:|DNS:'; then
      echo 'ERROR: generated self-signed certificate carries no subjectAltName' >&2
      exit 3
    fi
    ln -sfn /etc/letsencrypt/live/self-signed /etc/letsencrypt/live/nucrm
  "
  log "Self-signed cert installed at live/nucrm with SAN=${san}."
  CERT_KIND="self-signed"
}

issue_letsencrypt() {
  if [[ "$ENGINE" == openssl ]]; then
    issue_letsencrypt_local
    return
  fi
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
  CERT_KIND="letsencrypt"
}

# Host path for Let's Encrypt: apt/dnf-installed certbot writing straight into
# SSL_DIR. The webroot is the directory the host nginx serves for http-01.
issue_letsencrypt_local() {
  command -v certbot >/dev/null 2>&1 || {
    echo "certbot is not installed; install it or use --issuer docker|podman" >&2
    exit 1
  }
  if [[ -z "$ACME_EMAIL" ]]; then
    echo "ACME_EMAIL is required to issue a Let's Encrypt certificate." >&2
    echo "Set ACME_EMAIL in .env or export it, then re-run." >&2
    exit 1
  fi
  log "Requesting Let's Encrypt certificate for ${DOMAIN} with the host certbot (email ${ACME_EMAIL})..."
  mkdir -p "${SSL_DIR}" "${SSL_DIR}/work" "${SSL_DIR}/logs"
  certbot certonly \
    --webroot -w "${ACME_WEBROOT}" \
    -d "${DOMAIN}" \
    --email "${ACME_EMAIL}" \
    --agree-tos --no-eff-email \
    --non-interactive \
    --keep-until-expiring \
    --config-dir "${SSL_DIR}" \
    --work-dir "${SSL_DIR}/work" \
    --logs-dir "${SSL_DIR}/logs" \
    ${STAGING}
  link_live "${DOMAIN}"
  log "Let's Encrypt certificate active at ${SSL_DIR}/live/nucrm -> live/${DOMAIN}."
  CERT_KIND="letsencrypt"
}

reload_nginx() {
  log "Reloading nginx to pick up the certificate..."
  if [[ "$ENGINE" == openssl ]]; then
    if command -v nginx >/dev/null 2>&1; then
      nginx -s reload 2>/dev/null || log "nginx is not running on this host — it will read the cert on next start."
    else
      log "nginx is not installed on this host — skipping reload."
    fi
    return
  fi
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
if [[ "$ENGINE" == openssl ]]; then
  log "Done. nginx serves TLS from ${SSL_DIR}/live/nucrm/."
else
  log "Done. nginx serves TLS from /etc/letsencrypt/live/nucrm/."
fi
if [[ "$CERT_KIND" == "letsencrypt" ]]; then
  log "Renewal is automatic: the certbot container runs 'certbot renew' every 12h"
  log "and nginx reloads every 12h. Verify:  curl -sSf https://${DOMAIN}/health"
else
  # This is a self-signed fallback. 'certbot renew' is a permanent no-op here —
  # there is no ACME issuance to renew — so we must not tell the operator it is
  # being kept fresh. The SAN (not CN) is what a browser checks; verify with
  # -verify_ip / hostname validation, which curl's CN fallback would hide.
  log "SELF-SIGNED cert (SAN=$(compute_subject_alt_name "${DOMAIN:-localhost}")); it is NOT renewed by certbot."
  log "Valid 365 days — re-run this script before it expires, or set a real DOMAIN + ACME_EMAIL for Let's Encrypt."
  log "Verify (browser-grade, no CN fallback):  openssl s_client -connect ${DOMAIN:-localhost}:443 </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName"
fi

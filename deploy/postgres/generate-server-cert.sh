#!/usr/bin/env bash
#
# NuCRM — Generate the PostgreSQL server TLS certificate + key  [audit O2 / #1418]
#
# Postgres runs on the host with `ssl = on` (see postgresql.conf), so it needs a
# server.crt + server.key in its data directory. These are per-deployment
# artifacts and MUST NOT live in the repo (server.key/server.crt are gitignored).
# This script generates a self-signed pair suitable for `sslmode=require` (which
# encrypts the connection without verifying the CA). For `sslmode=verify-full`,
# use a certificate from your CA / Let's Encrypt instead and skip this script.
#
# Usage (on the DB host, as the postgres user or root):
#   sudo bash deploy/postgres/generate-server-cert.sh /var/lib/pgsql/data
#   # or, if PGDATA is exported:
#   sudo bash deploy/postgres/generate-server-cert.sh "$PGDATA"
#
# After running: restart Postgres and confirm TLS:
#   psql "host=<host> dbname=nucrm user=nucrm sslmode=require" -c 'SHOW ssl;'
#
set -euo pipefail

PGDATA="${1:-${PGDATA:-}}"
CN="${POSTGRES_TLS_CN:-nucrm-postgres}"
DAYS="${POSTGRES_TLS_DAYS:-825}"   # <=825 to satisfy modern clients

if [[ -z "${PGDATA}" ]]; then
  echo "Usage: $0 <PGDATA-dir>   (or export PGDATA)" >&2
  exit 2
fi
if [[ ! -d "${PGDATA}" ]]; then
  echo "PGDATA directory does not exist: ${PGDATA}" >&2
  exit 1
fi

CRT="${PGDATA}/server.crt"
KEY="${PGDATA}/server.key"

if [[ -f "${KEY}" && -f "${CRT}" ]]; then
  echo "==> server.crt and server.key already exist in ${PGDATA}."
  echo "    Refusing to overwrite. Delete them first if you want to regenerate."
  openssl x509 -in "${CRT}" -noout -subject -dates 2>/dev/null || true
  exit 0
fi

echo "==> Generating self-signed server certificate (CN=${CN}, ${DAYS} days)..."
openssl req -new -x509 -nodes \
  -newkey rsa:2048 \
  -keyout "${KEY}" \
  -out "${CRT}" \
  -days "${DAYS}" \
  -subj "/CN=${CN}/O=NuCRM"

# PostgreSQL refuses to start if the key is group/world-readable.
chmod 600 "${KEY}"
chmod 644 "${CRT}"

# Own by the postgres runtime user when it exists (ignore failure in containers).
if id postgres >/dev/null 2>&1; then
  chown postgres:postgres "${KEY}" "${CRT}" 2>/dev/null || true
fi

echo "==> Done:"
openssl x509 -in "${CRT}" -noout -subject -dates
echo
echo "Next:"
echo "  1. Ensure postgresql.conf has: ssl = on  (see deploy/postgres/postgresql.conf)"
echo "  2. Restart PostgreSQL."
echo "  3. Set DATABASE_URL=...?sslmode=require and DATABASE_SSL=true in .env"
echo "  4. Verify:  psql \"...sslmode=require\" -c 'SHOW ssl;'   → should print 'on'"

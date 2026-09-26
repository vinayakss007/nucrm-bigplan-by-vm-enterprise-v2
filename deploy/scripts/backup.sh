#!/usr/bin/env bash
###############################################################################
#  NuCRM — Database Backup Script  (#1038)
#
#  Usage:
#    bash deploy/scripts/backup.sh              # Full backup, upload to S3/MinIO
#    bash deploy/scripts/backup.sh --local      # Backup to local file only
#    bash deploy/scripts/backup.sh --restore FILE  # Restore from a .dump file
#
#  Topology note (IMPORTANT):
#    In PRODUCTION, PostgreSQL runs on the HOST (not in Docker) — see
#    deploy/docker-compose.production.yml. So this script does NOT
#    `docker exec` into a Postgres container. It runs pg_dump/pg_restore against
#    $DATABASE_URL directly: it uses a local pg client if present, otherwise a
#    one-shot postgres:18-alpine container on the compose network. This works in
#    both the host-Postgres (prod) and containerised-Postgres (dev) layouts.
#    The client's MAJOR version must be >= the server's: pg_dump refuses to run
#    against a newer server ("server version 18.6; pg_dump version 16.x ...
#    aborting because of server version mismatch"). The managed instance reports
#    server_version 18.6, so both the local client and the fallback image are 18.
#
#  Automated backups: the app's own scheduler (app/api/cron/auto-backup) writes
#  per-tenant logical backups into the DB and the cron container triggers it
#  daily at 02:00. THIS script is the full-cluster pg_dump for manual/DR use.
###############################################################################
set -euo pipefail
cd "$(dirname "$0")/.."

# Load env (DATABASE_URL, AWS_*, BACKUP_BUCKET, PG image, etc.)
# shellcheck disable=SC1091
source ../.env 2>/dev/null || true

# Topology override. In the pre-prod/managed-DB layout DATABASE_URL points at
# PgBouncer (`pgbouncer:6432`), a Docker-network hostname that does NOT resolve
# from the host this script runs on — and this script prefers the host's local
# pg_dump. BACKUP_DATABASE_URL lets a deployment aim the dump straight at the
# real server. It MUST be applied after `source` above, which would otherwise
# clobber an exported value. Unset (the default) changes nothing.
if [[ -n "${BACKUP_DATABASE_URL:-}" ]]; then
  DATABASE_URL="$BACKUP_DATABASE_URL"
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nucrm}"
BACKUP_FILE="nucrm_backup_${TIMESTAMP}.dump"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-7}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
COMPOSE_NETWORK="${BACKUP_DOCKER_NETWORK:-deploy_nucrm-net}"

log()  { echo "[BACKUP $(date +%H:%M:%S)] $*"; }
err()  { echo "[BACKUP ERROR] $*" >&2; exit 1; }

[[ -z "${DATABASE_URL:-}" ]] && err "DATABASE_URL is not set (source your .env)."

mkdir -p "$BACKUP_DIR"

# Run a pg client command. Prefer a local binary; fall back to a one-shot
# container joined to the compose network so it can resolve service names and
# reach host Postgres via host.docker.internal.
have_local_pg() { command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; }

pg_dump_run() {
  if have_local_pg; then
    pg_dump "$DATABASE_URL" "$@"
  else
    docker run --rm --network "$COMPOSE_NETWORK" \
      --add-host host.docker.internal:host-gateway \
      -e PGCONNECT_TIMEOUT=15 \
      "$PG_IMAGE" pg_dump "$DATABASE_URL" "$@"
  fi
}

pg_restore_run() {
  if have_local_pg; then
    pg_restore "$@"
  else
    docker run --rm -i --network "$COMPOSE_NETWORK" \
      --add-host host.docker.internal:host-gateway \
      -e PGCONNECT_TIMEOUT=15 \
      "$PG_IMAGE" pg_restore "$@"
  fi
}

psql_val() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -At -c "$1"
  else
    docker run --rm --network "$COMPOSE_NETWORK" \
      --add-host host.docker.internal:host-gateway \
      -e PGCONNECT_TIMEOUT=15 \
      "$PG_IMAGE" psql "$DATABASE_URL" -At -c "$1"
  fi
}

# PP-014 (#2050) — the dump role must bypass RLS. pg_dump issues
# `SET row_security = off` in its session, which PostgreSQL only honours for
# superuser / BYPASSRLS roles; every tenant-scoped table is FORCE ROW LEVEL
# SECURITY, so an RLS-bound role (the app role `nucrm`) aborts on the first
# data table with "query would be affected by row-level security policy" —
# after writing a partial file. Postgres' own HINT (ALTER TABLE ... NO FORCE
# ROW LEVEL SECURITY) must NEVER be followed: it would silently strip tenant
# isolation from the application to make a backup convenient. The fix is the
# BACKUP_DATABASE_URL role, not the policy (see PP-015 / .env.example).
require_dump_role() {
  local out role rights
  out=$(psql_val "SELECT current_user || E'\n' || CASE WHEN COALESCE(rolsuper, false) OR COALESCE(rolbypassrls, false) THEN 'bypass' ELSE 'rls-bound' END FROM pg_roles WHERE rolname = current_user" 2>/dev/null) \
    || err "Cannot reach the database — check DATABASE_URL / BACKUP_DATABASE_URL and connectivity."
  role=$(head -n1 <<<"$out")
  rights=$(tail -n1 <<<"$out")
  if [[ "$rights" != "bypass" ]]; then
    err "Dump role '$role' is RLS-bound, so pg_dump (SET row_security=off) will abort on FORCE-RLS tables. Point BACKUP_DATABASE_URL at a BYPASSRLS role (e.g. the managed 'upadmin' or a dedicated backup role) — see .env.example. Do NOT disable FORCE ROW LEVEL SECURITY to work around this: that removes tenant isolation from the app."
  fi
  log "Dump role '$role' may bypass RLS (PP-014 guard passed)."
}

backup_local() {
  require_dump_role
  log "Creating PostgreSQL dump (custom format, compressed)..."
  # --format=custom lets pg_restore do selective, parallel restores later.
  #
  # A failed pg_dump can still leave a PARTIAL file behind: the run against this
  # schema wrote 1.2 MB before dying on
  #   ERROR: query would be affected by row-level security policy for table
  #   "activities"
  # Such a file is worse than no backup at all — it is non-empty, so the sanity
  # check below passes, and a restore would silently rebuild a TRUNCATED
  # database. Remove it before reporting the failure.
  # --file=/dev/stdout is deliberately NOT used: inside the one-shot container
  # stdout is a pipe, and pg_dump fails the dump with
  #   could not fsync file "/dev/stdout": Invalid argument
  # A plain shell redirect leaves pg_dump writing to stdout with no fsync.
  pg_dump_run --format=custom --compress=6 --no-owner --no-privileges \
    > "${BACKUP_DIR}/${BACKUP_FILE}" \
    || {
      rm -f "${BACKUP_DIR}/${BACKUP_FILE}"
      err "pg_dump failed — check DATABASE_URL, connectivity, and the role's RLS rights."
    }

  local size
  size=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
  [[ -s "${BACKUP_DIR}/${BACKUP_FILE}" ]] || err "Backup file is empty — aborting."
  log "Backup created: ${BACKUP_DIR}/${BACKUP_FILE} (${size})"
}

upload_s3() {
  log "Uploading to S3/MinIO bucket '${BACKUP_BUCKET:-nucrm-backups}'..."
  # The MinIO container exists in production. Copy the dump in and push it with mc.
  if docker ps --format '{{.Names}}' | grep -q '^nucrm-minio$'; then
    docker exec nucrm-minio mc alias set local http://localhost:9000 \
      "${AWS_ACCESS_KEY_ID}" "${AWS_SECRET_ACCESS_KEY}" >/dev/null 2>&1 \
      || err "Could not configure mc alias inside nucrm-minio."
    docker cp "${BACKUP_DIR}/${BACKUP_FILE}" nucrm-minio:/tmp/
    docker exec nucrm-minio mc cp "/tmp/${BACKUP_FILE}" \
      "local/${BACKUP_BUCKET:-nucrm-backups}/db/${BACKUP_FILE}" \
      || err "Upload to MinIO failed."
    docker exec nucrm-minio rm -f "/tmp/${BACKUP_FILE}" 2>/dev/null || true
    log "Uploaded to s3://${BACKUP_BUCKET:-nucrm-backups}/db/${BACKUP_FILE}"
  else
    log "nucrm-minio container not found — skipping S3 upload (local copy kept)."
    log "For offsite storage, sync ${BACKUP_DIR} to external object storage."
  fi
}

cleanup_old() {
  log "Cleaning old local backups (keeping last ${KEEP_LOCAL})..."
  # shellcheck disable=SC2012
  ls -t "${BACKUP_DIR}"/nucrm_backup_*.dump 2>/dev/null \
    | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f || true
}

restore() {
  local file="${1:-}"
  [[ -z "$file" ]] && err "Usage: backup.sh --restore <file.dump>"
  [[ ! -f "$file" ]] && err "File not found: $file"

  log "WARNING: This OVERWRITES the current database with ${file}."
  read -r -p "Type 'yes' to confirm: " confirm
  [[ "$confirm" != "yes" ]] && { log "Aborted."; exit 0; }

  log "Restoring..."
  pg_restore_run --dbname "$DATABASE_URL" --clean --if-exists --no-owner < "$file" \
    || err "pg_restore reported errors — review output above."
  log "Restore complete. Restart the app so it reconnects cleanly:"
  log "  docker compose -f deploy/docker-compose.production.yml restart app worker"
}

case "${1:-}" in
  --local)   backup_local; cleanup_old ;;
  --restore) restore "${2:-}" ;;
  *)         backup_local; upload_s3; cleanup_old; log "Backup complete!" ;;
esac

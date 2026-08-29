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
#    one-shot postgres:16-alpine container on the compose network. This works in
#    both the host-Postgres (prod) and containerised-Postgres (dev) layouts.
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

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nucrm}"
BACKUP_FILE="nucrm_backup_${TIMESTAMP}.dump"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-7}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
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

backup_local() {
  log "Creating PostgreSQL dump (custom format, compressed)..."
  # --format=custom lets pg_restore do selective, parallel restores later.
  pg_dump_run --format=custom --compress=6 --no-owner --no-privileges \
    --file=/dev/stdout > "${BACKUP_DIR}/${BACKUP_FILE}" \
    || err "pg_dump failed — check DATABASE_URL and connectivity."

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

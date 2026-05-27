#!/usr/bin/env bash
###############################################################################
#  NuCRM — Database Backup Script
#
#  Usage:
#    bash deploy/scripts/backup.sh              # Full backup to S3
#    bash deploy/scripts/backup.sh --local      # Backup to local file only
#    bash deploy/scripts/backup.sh --restore FILE  # Restore from file
#
#  Automated: The cron container runs /api/cron/auto-backup daily at 02:00 UTC
#  This script is for manual/emergency backups.
###############################################################################
set -euo pipefail
cd "$(dirname "$0")/.."

source ../.env 2>/dev/null || true

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/nucrm-backups"
BACKUP_FILE="nucrm_backup_${TIMESTAMP}.sql.gz"
KEEP_LOCAL=5

mkdir -p "$BACKUP_DIR"

log() { echo "[BACKUP $(date +%H:%M:%S)] $*"; }

backup_local() {
    log "Creating PostgreSQL dump..."
    docker exec nucrm-postgres pg_dump \
        -U "${POSTGRES_USER:-nucrm}" \
        -d "${POSTGRES_DB:-nucrm}" \
        --format=custom \
        --compress=6 \
        --no-owner \
        --no-privileges \
        > "${BACKUP_DIR}/${BACKUP_FILE}"
    
    local size=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
    log "Backup created: ${BACKUP_DIR}/${BACKUP_FILE} (${size})"
}

upload_s3() {
    log "Uploading to S3 (MinIO)..."
    docker exec nucrm-minio mc alias set local http://localhost:9000 \
        "${AWS_ACCESS_KEY_ID}" "${AWS_SECRET_ACCESS_KEY}" 2>/dev/null
    
    docker cp "${BACKUP_DIR}/${BACKUP_FILE}" nucrm-minio:/tmp/
    docker exec nucrm-minio mc cp "/tmp/${BACKUP_FILE}" \
        "local/${BACKUP_BUCKET:-nucrm-backups}/db/${BACKUP_FILE}"
    
    log "Uploaded to s3://${BACKUP_BUCKET:-nucrm-backups}/db/${BACKUP_FILE}"
}

cleanup_old() {
    log "Cleaning old local backups (keeping last ${KEEP_LOCAL})..."
    ls -t "${BACKUP_DIR}"/nucrm_backup_*.sql.gz 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | xargs rm -f 2>/dev/null || true
}

restore() {
    local file="$1"
    [[ ! -f "$file" ]] && { echo "File not found: $file"; exit 1; }
    
    log "WARNING: This will OVERWRITE the current database!"
    read -p "Type 'yes' to confirm: " confirm
    [[ "$confirm" != "yes" ]] && { echo "Aborted."; exit 0; }
    
    log "Restoring from: $file"
    docker exec -i nucrm-postgres pg_restore \
        -U "${POSTGRES_USER:-nucrm}" \
        -d "${POSTGRES_DB:-nucrm}" \
        --clean --if-exists --no-owner \
        < "$file"
    
    log "Restore complete. Restart app: docker compose -f deploy/docker-compose.production.yml restart app worker"
}

case "${1:-}" in
    --local)   backup_local; cleanup_old ;;
    --restore) restore "${2:-}" ;;
    *)         backup_local; upload_s3; cleanup_old;
               log "Backup complete!" ;;
esac

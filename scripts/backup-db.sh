#!/bin/bash
set -euo pipefail

# NUCRM Database Backup Script
# Dumps PostgreSQL to MinIO S3 via mc (MinIO Client)
# Schedule: daily via cron at 3:00 AM UTC

BACKUP_DIR="/tmp/nucrm-backups"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/nucrm-${TIMESTAMP}.dump"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# pg_dump with compression
echo "[$(date)] Starting database backup..."
docker exec nucrm-db pg_dump \
  -h localhost \
  -p 5432 \
  -U nucrm \
  -d nucrm \
  --no-owner \
  --no-acl \
  -Fc \
  -f /tmp/backup.dump && \
docker cp nucrm-db:/tmp/backup.dump "$BACKUP_FILE" && \
docker exec nucrm-db rm -f /tmp/backup.dump

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Backup created: $BACKUP_FILE ($FILESIZE)"

# Upload to MinIO via mc — fail LOUDLY, never delete the local copy
# unless the remote upload is confirmed (a silent `mc` failure + `rm`
# previously left zero copies while logging success).
echo "[$(date)] Uploading to MinIO..."
: "${S3_SECRET_KEY:?S3_SECRET_KEY must be set (MinIO root password)}"
mc alias set local http://127.0.0.1:9000 nucrm "$S3_SECRET_KEY"
mc cp "$BACKUP_FILE" "local/nucrm-backups/db/"
echo "[$(date)] Upload complete (verified by mc exit code)."

# Cleanup local temp file — only reached when the upload above succeeded
# (set -e aborts the script on any mc failure, preserving the local file).
rm -f "$BACKUP_FILE"

# Prune old backups from MinIO (keep 30 days)
echo "[$(date)] Pruning backups older than ${RETENTION_DAYS} days..."
CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d)
mc ls "local/nucrm-backups/db/" 2>/dev/null | awk '{print $NF}' | while read -r fname; do
  fdate=$(echo "$fname" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1)
  if [[ -n "$fdate" && "$fdate" < "$CUTOFF" ]]; then
    mc rm "local/nucrm-backups/db/$fname" 2>/dev/null && echo "Pruned: $fname"
  fi
done

echo "[$(date)] Backup job complete."

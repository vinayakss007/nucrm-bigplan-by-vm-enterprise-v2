#!/bin/bash
# NuCRM Production Backup Script
set -euo pipefail

BACKUP_DIR="/home/vinayak_shruti_biz/nucrm/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nucrm_${TIMESTAMP}.sql.gz"

# Load env
source /home/vinayak_shruti_biz/nucrm/.env.local

mkdir -p "$BACKUP_DIR"

# Dump and compress
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U nucrm -d nucrm | gzip > "$BACKUP_FILE"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "nucrm_*.sql.gz" -mtime +7 -delete

echo "[$(date)] Backup completed: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

#!/bin/bash
set -euo pipefail

# NUCRM Database Backup Script
# Dumps PostgreSQL to MinIO S3 via mc (MinIO Client) AND registers every dump
# in `backup_records` (#2237), so scripts/restore-db.ts --latest,
# scripts/verify-backup.ts (backup:verify) and the super-admin restore panel
# can see, verify and restore the daily cron dumps. Previously this script
# uploaded artefacts the restore flow could not even find.
# Schedule: daily via cron at 3:00 AM UTC
#
# Required env:
#   DATABASE_URL    – app/catalog DB holding backup_records (registration).
#   S3_SECRET_KEY   – MinIO root password (as before).
# Optional:
#   BACKUP_BUCKET   – bucket for dumps. MUST match what the app resolves as
#                     its backup bucket (BACKUP_BUCKET || S3_BUCKET), otherwise
#                     restore/verify fetch the wrong bucket. Default: nucrm-backups.
#   BACKUP_DB_ROLE  – superuser/BYPASSRLS role used for pg_dump (see PP-014).

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="/tmp/nucrm-backups"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILENAME="nucrm-${TIMESTAMP}.dump"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILENAME}"
RETENTION_DAYS=30
BACKUP_BUCKET="${BACKUP_BUCKET:-nucrm-backups}"
# Same `backups/` key prefix the app's off-site path (lib/backups/offsite.ts)
# and the S3 retention purger use.
OBJECT_KEY="backups/${BACKUP_FILENAME}"

# PP-014 (#2050): pg_dump runs SET row_security=off, which PostgreSQL only
# honours for superuser/BYPASSRLS roles, while every tenant table is FORCE
# ROW LEVEL SECURITY. The app role therefore cannot produce a dump — pick a
# bypass role (inside the container the local `postgres` superuser qualifies).
# Never "fix" this by dropping FORCE RLS: that strips tenant isolation.
BACKUP_DB_ROLE="${BACKUP_DB_ROLE:-postgres}"

# Registration is mandatory (#2237): a dump that is not in backup_records is
# invisible to restore, i.e. effectively not a backup.
: "${DATABASE_URL:?DATABASE_URL must be set — backup-db.sh registers its dumps in backup_records (#2237)}"

# Every register call must resolve npx/tsx against the app checkout, so run
# from REPO_DIR regardless of the cron CWD.
register() {
  (cd "$REPO_DIR" && npx tsx scripts/register-script-backup.ts "$@")
}

mkdir -p "$BACKUP_DIR"

# Open the catalog row BEFORE dumping so an aborted run is recorded as
# 'failed' instead of vanishing (status vocabulary of lib/backups/backup-service.ts:
# running → completed | failed).
RECORD_ID="$(register begin --filename "$BACKUP_FILENAME" | tail -1)"
START_TS=$(date +%s)
COMPLETED=0

# On any later failure, mark the row failed (best-effort — never mask the
# original error, and never let the trap itself change the exit status).
on_error() {
  local rc=$?
  if [[ -n "$RECORD_ID" && "$COMPLETED" != 1 ]]; then
    local now_ts; now_ts=$(date +%s)
    register fail --id "$RECORD_ID" \
      --error "backup-db.sh aborted with exit code ${rc} (see cron logs for details)" \
      --duration-ms $(( (now_ts - START_TS) * 1000 )) \
      >/dev/null 2>&1 || true
  fi
  return $rc
}
trap on_error ERR

BYPASS=$(docker exec nucrm-db psql -h localhost -U "$BACKUP_DB_ROLE" -d nucrm -At -c \
  "SELECT CASE WHEN COALESCE(rolsuper,false) OR COALESCE(rolbypassrls,false) THEN 'bypass' ELSE 'rls-bound' END FROM pg_roles WHERE rolname = current_user") \
  || { echo "[$(date)] ERROR: cannot reach database as role '$BACKUP_DB_ROLE'" >&2; exit 1; }
if [[ "$BYPASS" != "bypass" ]]; then
  echo "[$(date)] ERROR: dump role '$BACKUP_DB_ROLE' is RLS-bound; pg_dump will abort on FORCE-RLS tables (PP-014). Set BACKUP_DB_ROLE to a superuser/BYPASSRLS role." >&2
  exit 1
fi

# pg_dump with compression
echo "[$(date)] Starting database backup..."
docker exec nucrm-db pg_dump \
  -h localhost \
  -p 5432 \
  -U "$BACKUP_DB_ROLE" \
  -d nucrm \
  --no-owner \
  --no-acl \
  -Fc \
  -f /tmp/backup.dump && \
docker cp nucrm-db:/tmp/backup.dump "$BACKUP_FILE" && \
docker exec nucrm-db rm -f /tmp/backup.dump

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
SIZE_BYTES=$(stat -c%s "$BACKUP_FILE")
CHECKSUM=$(sha256sum "$BACKUP_FILE" | awk '{print $1}')
echo "[$(date)] Backup created: $BACKUP_FILE ($FILESIZE, sha256=$CHECKSUM)"

# Upload to MinIO via mc — fail LOUDLY, never delete the local copy
# unless the remote upload is confirmed (a silent `mc` failure + `rm`
# previously left zero copies while logging success).
echo "[$(date)] Uploading to MinIO..."
: "${S3_SECRET_KEY:?S3_SECRET_KEY must be set (MinIO root password)}"
mc alias set local http://127.0.0.1:9000 nucrm "$S3_SECRET_KEY"
mc cp "$BACKUP_FILE" "local/${BACKUP_BUCKET}/backups/"
echo "[$(date)] Upload complete (verified by mc exit code)."

# Register the dump in the catalog AFTER the upload is confirmed; this is what
# makes `restore-db --latest` and `backup:verify` able to see and prove it.
END_TS=$(date +%s)
register complete \
  --id "$RECORD_ID" \
  --filename "$BACKUP_FILENAME" \
  --size-bytes "$SIZE_BYTES" \
  --storage-path "$OBJECT_KEY" \
  --storage-type "s3" \
  --checksum "$CHECKSUM" \
  --duration-ms $(( (END_TS - START_TS) * 1000 )) \
  --bucket "$BACKUP_BUCKET"
COMPLETED=1
echo "[$(date)] Registered backup_records row $RECORD_ID"

# Cleanup local temp file — only reached when the upload above succeeded
# (set -e aborts the script on any mc failure, preserving the local file).
rm -f "$BACKUP_FILE"

# Prune old backups from MinIO (keep 30 days)
echo "[$(date)] Pruning backups older than ${RETENTION_DAYS} days..."
CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d)
mc ls "local/${BACKUP_BUCKET}/backups/" 2>/dev/null | awk '{print $NF}' | while read -r fname; do
  fdate=$(echo "$fname" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1)
  if [[ -n "$fdate" && "$fdate" < "$CUTOFF" ]]; then
    mc rm "local/${BACKUP_BUCKET}/backups/$fname" 2>/dev/null && echo "Pruned: $fname"
  fi
done

echo "[$(date)] Backup job complete."

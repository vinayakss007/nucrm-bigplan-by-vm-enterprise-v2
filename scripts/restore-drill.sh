#!/usr/bin/env bash
# NuCRM — restore drill for RLS-safe dumps (#2124)
#
# Proves that a scripts/backup-rls-live.sh dump actually restores: applies
# schema.sql into a scratch database, loads every CSV from the manifest,
# re-applies sequence values, then compares per-table row counts against
# manifest.txt. A backup nobody has restored is a rumor.
#
# Usage:
#   DRILL_DATABASE_URL=postgres://... \
#     ./scripts/restore-drill.sh /var/tmp/nucrm-backups/2026-09-26_050000
#
# Env:
#   DRILL_DATABASE_URL  admin connection able to CREATE/DROP DATABASE on the
#                       target cluster (defaults to BACKUP_DATABASE_URL)
#   SCRATCH_DB          scratch database name (default nucrm_restore_drill)
#   KEEP=1              leave the scratch DB in place after the drill
#
# Exit 0 = restored and every manifest row count matched. Non-zero = the
# dump is NOT proven restorable; the reason is printed on stderr.

set -euo pipefail

DUMP_DIR="${1:?usage: restore-drill.sh <dump dir produced by backup-rls-live.sh>}"
DRILL_DATABASE_URL="${DRILL_DATABASE_URL:-${BACKUP_DATABASE_URL:?set DRILL_DATABASE_URL (or BACKUP_DATABASE_URL)}}"
SCRATCH_DB="${SCRATCH_DB:-nucrm_restore_drill}"
KEEP="${KEEP:-0}"
ZERO_UUID='00000000-0000-0000-0000-000000000000'

# Same super-admin GUC recipe the backup uses: tables are FORCE ROW LEVEL
# SECURITY, so even the owner needs the policy's bypass predicate to INSERT.
export PGOPTIONS="-c app.is_super_admin=true -c app.current_tenant=$ZERO_UUID -c app.current_user=$ZERO_UUID"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { echo "DRILL FAIL: $*" >&2; exit 1; }

[ -f "$DUMP_DIR/schema.sql" ] || fail "missing $DUMP_DIR/schema.sql"
[ -f "$DUMP_DIR/manifest.txt" ] || fail "missing $DUMP_DIR/manifest.txt"
[ -d "$DUMP_DIR/data" ] || fail "missing $DUMP_DIR/data/"

# Swap only the database segment of the URL, preserving authority and any
# query string (?sslmode=require etc). Split on the first '?' — a literal '?'
# in credentials would have to be percent-encoded, so this is unambiguous.
ADMIN_BASE="${DRILL_DATABASE_URL%%\?*}"
if [ "$ADMIN_BASE" = "$DRILL_DATABASE_URL" ]; then
  SCRATCH_URL="${ADMIN_BASE%/*}/$SCRATCH_DB"
else
  QUERY="${DRILL_DATABASE_URL#*\?}"
  SCRATCH_URL="${ADMIN_BASE%/*}/$SCRATCH_DB?$QUERY"
fi
SOURCE_DB="${ADMIN_BASE##*/}"
if [ "$SOURCE_DB" = "$SCRATCH_DB" ]; then
  fail "SCRATCH_DB ($SCRATCH_DB) must differ from the database the admin URL points at ($SOURCE_DB)"
fi

psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -c "SELECT 'db-ok'" >/dev/null \
  || fail "cannot reach cluster at $DRILL_DATABASE_URL"

log "recreating scratch database $SCRATCH_DB"
psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE)"
psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $SCRATCH_DB TEMPLATE template0"

log "applying schema.sql"
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP_DIR/schema.sql"

psql_q() { psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -Atq -c "$1"; }

log "loading data (manifest-driven)"
total=0
while IFS=$'\t' read -r ts_ rows_ bytes_; do
  [ -n "${ts_:-}" ] || continue
  schema="${ts_%%.*}"; table="${ts_#*.}"
  file="$DUMP_DIR/data/$schema--$table.csv.gz"
  [ -f "$file" ] || fail "manifest lists $ts_ but $file is missing"
  gunzip -c "$file" | psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q \
    -c "\\copy \"$schema\".\"$table\" FROM stdin WITH (FORMAT csv, HEADER)"
  total=$((total+1))
done < "$DUMP_DIR/manifest.txt"
log "$total tables loaded"

if [ -s "$DUMP_DIR/sequences.sql" ]; then
  log "applying sequences.sql"
  psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP_DIR/sequences.sql"
fi

log "verifying row counts against manifest"
mismatch=0
while IFS=$'\t' read -r ts_ rows_ bytes_; do
  [ -n "${ts_:-}" ] || continue
  schema="${ts_%%.*}"; table="${ts_#*.}"
  want="${rows_#rows=}"
  got=$(psql_q "SELECT count(*) FROM \"$schema\".\"$table\"")
  if [ "$got" != "$want" ]; then
    echo "DRILL FAIL: $ts_ expected rows=$want got=$got" >&2
    mismatch=$((mismatch+1))
  fi
done < "$DUMP_DIR/manifest.txt"
[ "$mismatch" -eq 0 ] || fail "$mismatch table(s) did not match the manifest"

if [ "$KEEP" != "1" ]; then
  log "dropping scratch database (KEEP=1 to retain)"
  psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE)"
fi

log "DRILL PASS: $total tables restored, all manifest row counts matched"

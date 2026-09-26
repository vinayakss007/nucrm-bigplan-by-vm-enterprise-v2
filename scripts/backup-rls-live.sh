#!/usr/bin/env bash
set -euo pipefail

# NUCRM backup for FORCE-RLS managed databases (#2124).
#
# Every tenant table is FORCE ROW LEVEL SECURITY and the managed pre-prod /
# prod database exposes NO superuser or BYPASSRLS role, so plain pg_dump
# aborts ("query would be affected by row-level security policy") and silently
# produces nothing. This script uses the app's own platform-escalation GUCs —
# the same ones the super-admin API path uses — over a client-side dump:
#
#   app.is_super_admin=true  → RLS policies resolve to the bypass branch
#   app.current_tenant / app.current_user → dummy UUIDs (never read by the
#   bypass policy, but required to be present for context helpers)
#
# Output (BACKUP_DIR, default /var/tmp/nucrm-backups, mode 0700):
#   schema-<ts>/schema.sql      pg_dump --schema-only (DDL, indexes, policies)
#   schema-<ts>/sequences.sql   sequence values
#   schema-<ts>/data/<t>.csv.gz \copy per table (client-side; pgbouncer-safe)
#   schema-<ts>/manifest.txt    table list + row counts + sizes
#
# Required env: BACKUP_DATABASE_URL (falls back to DATABASE_URL). Prefer a
# direct connection: pooler statement_timeout can cut long \copy runs.
#
# Restore smoke test (weekly): create a scratch DB, apply schema.sql +
# sequences.sql, COPY the CSVs back, compare manifest row counts.

BACKUP_URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:?set BACKUP_DATABASE_URL (or DATABASE_URL)}}"
BACKUP_DIR="${BACKUP_DIR:-/var/tmp/nucrm-backups}"
KEEP="${BACKUP_KEEP_SETS:-7}"
TS="$(date -u +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/$TS"
ZERO_UUID='00000000-0000-0000-0000-000000000000'

export PGOPTIONS="-c app.is_super_admin=true -c app.current_tenant=$ZERO_UUID -c app.current_user=$ZERO_UUID"

umask 077
mkdir -p "$OUT/data"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

psql_q() { psql "$BACKUP_URL" -v ON_ERROR_STOP=1 -Atq -c "$1"; }

psql_q "SELECT 'db-ok'" >/dev/null || { log "FATAL: cannot reach database"; exit 1; }

# ── schema (DDL only → RLS not consulted) ──────────────────────────────────
pg_dump "$BACKUP_URL" --schema-only --no-owner --no-privileges -f "$OUT/schema.sql"
log "schema.sql written ($(stat -c%s "$OUT/schema.sql") bytes)"

# ── sequence values ────────────────────────────────────────────────────────
: > "$OUT/sequences.sql"
# pg_statio_user_sequences: stable across versions (pg_sequences.seqname was
# renamed to `name` in PG16).
for s in $(psql_q "SELECT schemaname||'.'||relname FROM pg_catalog.pg_statio_user_sequences"); do
  last=$(psql_q "SELECT last_value FROM $s")
  echo "SELECT setval('$s', $last);" >> "$OUT/sequences.sql"
done
log "sequences.sql written ($(wc -l < "$OUT/sequences.sql") entries)"

# ── per-table CSV via \copy ... TO stdout (client-side) ────────────────────
n=0
: > "$OUT/manifest.txt"
# public.* plus drizzle.* (__drizzle_migrations ledger — needed for a
# consistent restore; migration state must match the schema dump).
for ts_ in $(psql_q "SELECT schemaname||'.'||tablename FROM pg_catalog.pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY 1"); do
  schema="${ts_%%.*}"; t="${ts_#*.}"
  count=$(psql_q "SELECT count(*) FROM \"$schema\".\"$t\"")
  psql "$BACKUP_URL" -v ON_ERROR_STOP=1 -Atq -c "\\copy (SELECT * FROM \"$schema\".\"$t\") TO stdout WITH (FORMAT csv, HEADER)" | gzip -1 > "$OUT/data/$schema--$t.csv.gz"
  size=$(stat -c%s "$OUT/data/$schema--$t.csv.gz")
  printf '%s\trows=%s\tbytes=%s\n' "$ts_" "$count" "$size" >> "$OUT/manifest.txt"
  n=$((n+1))
done
log "dumped $n tables"

sha256sum "$OUT/schema.sql" > "$OUT/SHA256SUMS"

# ── retention: keep the newest $KEEP sets ──────────────────────────────────
ls -1dt "$BACKUP_DIR"/[0-9]*/ 2>/dev/null | tail -n "+$((KEEP+1))" | while read -r old; do rm -rf "${old%/}"; done

log "backup set complete: $OUT ($(du -sh "$OUT" | cut -f1))"

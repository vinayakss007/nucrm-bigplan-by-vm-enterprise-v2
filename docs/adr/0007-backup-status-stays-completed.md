# ADR-0007: Backup status stays `completed` when only the off-site copy fails

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The S3 upload was gated on `process.env.S3_ACCESS_KEY_ID`, but
`docker-compose.yml` only exports `S3_ACCESS_KEY`. Under Docker the upload block
never ran, so backups stayed in `/tmp/nucrm-backups` inside an ephemeral
container while `backup_records.status` reported `completed`. Every container
restart destroyed the backup history — and the dashboard said everything was
fine.

Once the upload actually runs it can also fail on its own. The obvious response
is a distinct status such as `completed_local_only`.

## Decision

`status` stays `completed` when the dump succeeded but the off-site copy did not.
The failure is recorded in `error_message` and `metadata.offsite` instead.

The reason is what reads that column: `/api/superadmin/restore` and
`/api/cron/backup-health` both filter on `status = 'completed'`. Introducing a
new value would make the local copy invisible to the restore UI — so the moment a
backup was _most_ fragile (one copy, no off-site) would be the moment the operator
could no longer restore from it.

`/api/system/health` surfaces off-site staleness separately, which is where a
degraded backup should be visible.

## Consequences

- `status = 'completed'` alone does not mean "durable". Anything asserting
  durability must also read `metadata.offsite`. This is a genuine trap and the
  reason this ADR exists.
- A per-artefact sha256 checksum (`0042`) is stored so a restore can verify the
  file it fetched matches what was written. `NULL` means "unverifiable", not
  "valid".

## Alternatives considered

- **A `completed_local_only` status.** Rejected: hides the only surviving copy
  from restore, as above. Would be viable together with updating both consumers,
  which is a larger coordinated change.
- **Mark the backup `failed`.** Rejected: the dump succeeded and is restorable.
  Calling it failed would discard a usable backup and train operators to ignore
  the status.
- **Keep `console.error` and move on.** Rejected: that is the original bug — an
  upload failure that nothing surfaced.

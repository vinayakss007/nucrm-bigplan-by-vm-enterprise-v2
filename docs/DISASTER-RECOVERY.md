# Disaster Recovery — Backup Restore Runbook

> Operator runbook for restoring the NuCRM database from a backup. Addresses #1476.
> Backups you have never restored are not proven backups — rehearse this **before** you need it.

## What exists

| Capability         | Command                                          | Purpose                                                                                                                                     |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Create backup      | `lib/backups/backup-service.ts` (via app / cron) | pg_dump → optional AES-256-GCM encrypt → checksum → local or S3/R2                                                                          |
| **Verify / drill** | `npm run backup:verify`                          | Proves the latest (or `--id`) backup is intact **and restorable** by loading it into a throwaway scratch DB, then dropping it. Reports RTO. |
| **Restore (DR)**   | `npm run db:restore` (alias `backup:restore`)    | Restores a chosen backup into a **real target** database. Destructive → requires `--confirm`.                                               |

## Restore procedure (real recovery)

1. **Provision a fresh, empty target database** (do not restore over a live DB).

2. **Set env:**

   ```bash
   export DATABASE_URL=<the app/catalog DB that holds backup_records>
   export TARGET_DATABASE_URL=<the fresh DB to restore INTO>
   export BACKUP_ENCRYPTION_KEY=<required only if backups are encrypted>
   # S3_* vars required only if the backup is stored off-site
   ```

3. **Dry-run first** (locates the artefact, verifies checksum, decrypts — never writes to the target):

   ```bash
   npm run db:restore -- --latest --dry-run
   # or a specific one:
   npm run db:restore -- --id <backup-uuid> --dry-run
   ```

4. **Restore for real:**

   ```bash
   npm run db:restore -- --latest --confirm
   ```

5. **Validate** the restored DB:

   ```bash
   DATABASE_URL=$TARGET_DATABASE_URL npm run db:verify-integrity
   DATABASE_URL=$TARGET_DATABASE_URL npm run db:verify-isolation
   ```

6. **Cut over:** point the app's `DATABASE_URL` at the restored database and restart.

### Safety guards built into `db:restore`

- Refuses to run without `--confirm` (or `--dry-run`).
- Refuses when `TARGET_DATABASE_URL === DATABASE_URL` unless `--allow-same-db`.
- Refuses a target that already has tables unless `--allow-nonempty`.
- Fails closed on a checksum mismatch.
- Decrypts `.enc` artefacts using `BACKUP_ENCRYPTION_KEY` (supports key rotation via the previous key).

## Restore drill (rehearse quarterly, and before launch)

The drill is already automated by `backup:verify` — run it against a scratch DB and record the numbers:

```bash
npm run backup:verify            # latest backup: checksum + real pg_restore into scratch DB + row checks
```

Record after each drill:

| Metric                    | How to read it                                                | Target            |
| ------------------------- | ------------------------------------------------------------- | ----------------- |
| **RPO** (max data loss)   | Backup cadence (e.g. daily cron → up to 24h)                  | Define & document |
| **RTO** (time to restore) | Printed by `backup:verify` / `db:restore` (`completed in Ns`) | Define & document |
| Integrity                 | `ok checksum` line                                            | Must pass         |
| Restorability             | `ok restore` + table/row counts                               | Must pass         |

> **Launch gate:** at least one successful `db:restore` dry-run against a real off-site (S3) backup, plus one full `backup:verify` drill, with RTO/RPO recorded here.

## Recommended automation

- Schedule `backup:verify` (e.g. daily/weekly) and alert on non-zero exit — a backup that can't be restored should page someone _before_ an incident, not during one.
- Keep at least one **off-site (S3/R2)** copy; local-only backups do not survive container/host loss.

# Backups & Disaster Recovery

How NuCRM backs up data, how to restore it, and how to recover from disasters.

> Companion runbooks (authoritative procedures): [`docs/DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md),
> [`docs/runbooks/disaster-recovery.md`](../runbooks/disaster-recovery.md),
> [`docs/runbooks/restore-one-organization.md`](../runbooks/restore-one-organization.md),
> [`docs/postgres-hosting-and-recovery.md`](../postgres-hosting-and-recovery.md).

---

## Backup strategy

- **Automated database backups** run on a schedule via the `auto-backup` cron job
  (`lib/backups/`). Backups are uploaded to **S3-compatible object storage**.
- **Encryption at rest:** when `BACKUP_ENCRYPTION_KEY` is set, `pg_dump` output is encrypted with
  **AES-256-GCM** before upload. `BACKUP_ENCRYPTION_KEY_PREV` allows key rotation without
  invalidating older backups.
- **Retention:** `BACKUP_RETENTION_DAYS` controls how long backup objects are kept.
- **Verification:** the `backup-verify` and `backup-health` cron jobs check that backups exist and
  are restorable; `npm run backup:verify` verifies on demand.

> ⚠️ **Off-site storage is mandatory in production.** If the S3 bucket/keys aren't fully
> configured, backups stay on the app host only and **do not survive a container restart**. Verify
> `S3_BUCKET`/`BACKUP_BUCKET` and credentials — see [Configuration](./configuration.md).

---

## Where backups live

| Setting | Meaning |
| --- | --- |
| `S3_BUCKET` | Files, and backups when `BACKUP_BUCKET` is unset. |
| `BACKUP_BUCKET` | Dedicated backup bucket (recommended). |
| `S3_ENDPOINT` / `S3_REGION` | Provider endpoint (e.g. Cloudflare R2) and region. |

S3 lifecycle guidance: [`docs/infra/s3-backup-lifecycle.md`](../infra/s3-backup-lifecycle.md).

---

## Restore types

### 1. Full database restore

Restore the entire database from a backup artifact. Use for catastrophic loss.

```bash
npm run backup:restore     # or: npm run db:restore
npm run dr                 # disaster-recovery helper
```

Follow [`docs/DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md) exactly; validate on a staging target
before touching production.

### 2. Selective restore (single tenant / subset)

When only **one workspace** or a subset of data needs recovering, use **selective restore** rather
than a full restore, so you don't overwrite healthy tenants.

- Operator UI: **Super-Admin Console → Selective restore** (`app/superadmin/selective-restore`).
- Backed by `lib/restore/`; every action is written to `selective_restore_audit_log`.
- Procedure: [`docs/runbooks/restore-one-organization.md`](../runbooks/restore-one-organization.md).

---

## Disaster-recovery drills

Treat DR as something you **practice**, not just document:

1. Provision a clean database target (staging).
2. Restore the latest verified backup into it (`npm run backup:restore`).
3. Run integrity/isolation checks: `npm run db:verify-integrity`, `npm run db:verify-isolation`.
4. Smoke-test the app against the restored data (`npm run smoke`).
5. Record the RTO/RPO you achieved and any gaps.

---

## Recovery scenarios (quick index)

| Scenario | Start here |
| --- | --- |
| Total DB loss | [`docs/DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md) |
| One tenant's data corrupted/deleted | [`restore-one-organization.md`](../runbooks/restore-one-organization.md) |
| Migration went wrong / schema drift | [`migration-drift-recovery.md`](../runbooks/migration-drift-recovery.md) |
| Backups failing / missing | Check `backup-health` cron + S3 config ([Configuration](./configuration.md)) |
| Postgres host recovery | [`postgres-hosting-and-recovery.md`](../postgres-hosting-and-recovery.md) |

---

## Related

- [Configuration → Backups & encryption](./configuration.md#backups--encryption)
- [Super-Admin Console → Backups / Selective restore](./superadmin-console.md#operations--reliability)
- [Operations Runbooks](./runbooks.md)

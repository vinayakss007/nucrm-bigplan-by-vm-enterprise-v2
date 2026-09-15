# `BACKUP_DATABASE_URL` still points at the RLS-bound app role (PP-015)

**Severity:** HIGH — backups remain broken after the PP-014 diagnosis
**Area:** Infra / deploy
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-015](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

The pre-prod `.env` sets `BACKUP_DATABASE_URL` to the application role `nucrm`, which is neither
superuser nor `BYPASSRLS`. Every backup run therefore inherits the PP-014 failure mode and no usable dump
is produced.

## Steps to reproduce

```bash
cd /srv/nucrm && grep -o 'BACKUP_DATABASE_URL=.*@' .env     # shows the nucrm role
bash deploy/scripts/backup.sh                                # fails
```

## Expected vs actual

- **Expected:** `backup.sh` exits 0, writes a full dump and uploads it to object storage.
- **Actual:** non-zero exit; no dump (or, before PP-004, a truncated one).

## Why

The backup role must be able to see all rows; the app role deliberately cannot. `BACKUP_DATABASE_URL` is
consumed only by `backup.sh` (no application code references it), so pointing it at `upadmin` — a
least-privilege `BYPASSRLS` role — is the correct split of duties rather than a privilege escalation for
the app.

## File / route

- `.env` (`BACKUP_DATABASE_URL`), `deploy/scripts/backup.sh`

## Proposed fix

Point `BACKUP_DATABASE_URL` at `upadmin` (or another dedicated `BYPASSRLS` role), re-run
`deploy/scripts/backup.sh`, and verify: exit 0, no partial file left in `/var/backups/nucrm/`, object
present in the bucket, and a successful test restore. Add the role choice to the backup documentation so
a future `.env` refresh cannot silently reintroduce the app role.

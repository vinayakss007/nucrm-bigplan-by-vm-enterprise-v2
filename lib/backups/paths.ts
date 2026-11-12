/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2540 — one name for the directory backups are written to.
 *
 * The writer (`lib/backups/backup-service.ts`, the cron route and
 * `scripts/backup-db.ts`) reads `BACKUP_LOCAL_DIR`; the health check and the
 * host shell scripts read `BACKUP_DIR`; and both had their own default. On a
 * host that set only one of them the health endpoint inspected an empty
 * directory while dumps were written somewhere else, so "backups are fine"
 * and "no backups" were both answerable from the same host.
 *
 * `BACKUP_LOCAL_DIR` is canonical. `BACKUP_DIR` stays readable as the legacy
 * alias so existing deployments do not silently move their dumps; a host that
 * sets both gets the explicit `BACKUP_LOCAL_DIR` value. The shell scripts
 * implement the same precedence, and `.env.example` documents it.
 */
export const DEFAULT_BACKUP_DIR = '/tmp/nucrm-backups';

/** The directory dumps are written to and read from, under one precedence. */
export function resolveBackupDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env['BACKUP_LOCAL_DIR'] || env['BACKUP_DIR'] || DEFAULT_BACKUP_DIR;
}

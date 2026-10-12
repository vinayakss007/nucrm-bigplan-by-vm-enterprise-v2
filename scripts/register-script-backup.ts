#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2237 — tiny CLI that lets `scripts/backup-db.sh` register its dumps in the
 * `backup_records` catalog. All logic lives in
 * `lib/backups/script-backup-record.ts` (unit-tested there); this file only
 * parses argv.
 *
 * Subcommands:
 *   begin    --filename <name>                          → prints the new row id (one line)
 *   complete --id <uuid> --filename <name> --size-bytes <n>
 *            --storage-path <key> --storage-type <s3|local>
 *            --checksum <sha256hex> --duration-ms <n> [--bucket <name>]
 *   fail     --id <uuid> [--error <message>] [--duration-ms <n>]
 *
 * Env: DATABASE_URL (the app/catalog DB that holds backup_records).
 * Exits non-zero on any failure so the calling script can react.
 */
import {
  beginRunbookBackupRecord,
  completeRunbookBackupRecord,
  failRunbookBackupRecord,
} from '@/lib/backups/script-backup-record';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 || i === process.argv.length - 1 ? undefined : process.argv[i + 1];
}

function required(name: string): string {
  const value = flag(name);
  if (!value) {
    throw new Error(`missing required argument ${name}`);
  }
  return value;
}

function positiveInt(name: string): number {
  const raw = required(name);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return n;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'begin': {
      const handle = await beginRunbookBackupRecord({ filename: required('--filename') });
      // Stdout contract: exactly one line, the new backup_records id.
      console.log(handle.id);
      return;
    }
    case 'complete': {
      await completeRunbookBackupRecord({
        id: required('--id'),
        filename: required('--filename'),
        sizeBytes: positiveInt('--size-bytes'),
        storagePath: required('--storage-path'),
        storageType: required('--storage-type'),
        checksum: required('--checksum'),
        durationMs: positiveInt('--duration-ms'),
        ...(flag('--bucket') ? { bucket: flag('--bucket') } : {}),
      });
      console.log('ok');
      return;
    }
    case 'fail': {
      await failRunbookBackupRecord({
        id: required('--id'),
        error: new Error(flag('--error') ?? 'backup-db.sh failed'),
        ...(flag('--duration-ms') ? { durationMs: positiveInt('--duration-ms') } : {}),
      });
      console.log('ok');
      return;
    }
    default:
      console.error('Usage: register-script-backup.ts <begin|complete|fail> [options]');
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(
    `[register-script-backup] "${process.argv[2] ?? '?'}" failed:`,
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});

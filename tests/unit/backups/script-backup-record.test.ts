/**
 * Unit tests for the runbook-script backup registration helper (#2237).
 *
 * The script path (scripts/backup-db.sh → scripts/register-script-backup.ts →
 * lib/backups/script-backup-record.ts) must write the SAME status vocabulary
 * and columns as the app's own backup path (lib/backups/backup-service.ts):
 *   running → completed (size, path/key, checksum, sha256, completedAt)
 *   running → failed    (redacted+truncated error_message)
 * so restore-db / verify-backup / the super-admin restore list can see and
 * prove the daily cron dumps.
 *
 * DB is mocked exactly like tests/unit/webhook-idempotency.test.ts — the
 * drizzle chain is captured, no real connection is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let insertValues: Record<string, unknown>[] = [];
let insertReturning: unknown[] = [{ id: 'bkp-script-1' }];
let setPayloads: Record<string, unknown>[] = [];
let setWheres: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertValues.push(v);
        return {
          returning: vi.fn(async () => insertReturning),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        setPayloads.push(v);
        return {
          where: vi.fn((cond: unknown) => {
            setWheres.push(cond);
            return { returning: vi.fn(async () => []) };
          }),
        };
      }),
    })),
  },
}));

import {
  beginRunbookBackupRecord,
  completeRunbookBackupRecord,
  failRunbookBackupRecord,
  RUNBOOK_BACKUP_SOURCE,
  RUNBOOK_BACKUP_SCRIPT,
} from '@/lib/backups/script-backup-record';

describe('runbook backup registration (#2237)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues = [];
    insertReturning = [{ id: 'bkp-script-1' }];
    setPayloads = [];
    setWheres = [];
  });

  describe('begin', () => {
    it('opens a running row with script-discriminator metadata', async () => {
      const handle = await beginRunbookBackupRecord({ filename: 'nucrm-2026-10-03_030000.dump' });
      expect(handle.id).toBe('bkp-script-1');
      expect(insertValues).toHaveLength(1);

      const row = insertValues[0]!;
      expect(row.status).toBe('running');
      expect(row.backupType).toBe('full');
      expect(row.initiatedAuto).toBe(true);
      expect(row.expiresAt).toBeDefined(); // 30-day horizon, same as backup-service
      expect(row.metadata).toMatchObject({
        source: RUNBOOK_BACKUP_SOURCE,
        script: RUNBOOK_BACKUP_SCRIPT,
        filename: 'nucrm-2026-10-03_030000.dump',
      });
    });

    it('throws when the insert returns no row (catalog write must not be lost silently)', async () => {
      insertReturning = [];
      await expect(beginRunbookBackupRecord({ filename: 'x.dump' })).rejects.toThrow(
        /Failed to create backup_records row/,
      );
    });
  });

  describe('complete', () => {
    it('writes the same success columns backup-service uses', async () => {
      await completeRunbookBackupRecord({
        id: 'bkp-script-1',
        filename: 'nucrm-2026-10-03_030000.dump',
        sizeBytes: 123456789,
        storagePath: 'backups/nucrm-2026-10-03_030000.dump',
        storageType: 's3',
        checksum: 'a'.repeat(64),
        durationMs: 45000,
        bucket: 'nucrm-backups',
      });

      expect(setPayloads).toHaveLength(1);
      const patch = setPayloads[0]!;
      expect(patch.status).toBe('completed');
      expect(patch.sizeBytes).toBe(123456789);
      expect(patch.storagePath).toBe('backups/nucrm-2026-10-03_030000.dump');
      expect(patch.storageType).toBe('s3');
      expect(patch.checksum).toBe('a'.repeat(64));
      expect(patch.checksumAlgorithm).toBe('sha256');
      expect(patch.durationMs).toBe(45000);
      expect(patch.completedAt).toBeInstanceOf(Date);
      expect(patch.metadata).toMatchObject({
        source: RUNBOOK_BACKUP_SOURCE,
        filename: 'nucrm-2026-10-03_030000.dump',
        offsite: true,
        bucket: 'nucrm-backups',
      });
      expect(setWheres).toHaveLength(1); // scoped to the opened row id
    });

    it('records an offsite=false metadata for local-only dumps', async () => {
      await completeRunbookBackupRecord({
        id: 'bkp-script-1',
        filename: 'nucrm-local.dump',
        sizeBytes: 1,
        storagePath: '/tmp/nucrm-backups/nucrm-local.dump',
        storageType: 'local',
        checksum: 'b'.repeat(64),
        durationMs: 10,
      });
      expect(setPayloads[0]!.metadata).toMatchObject({ offsite: false });
      expect(setPayloads[0]!.storagePath).toBe('/tmp/nucrm-backups/nucrm-local.dump');
    });
  });

  describe('fail', () => {
    it('writes status=failed with the error message', async () => {
      await failRunbookBackupRecord({
        id: 'bkp-script-1',
        error: new Error('pg_dump failed with code 2: could not write file'),
        durationMs: 3000,
      });

      expect(setPayloads).toHaveLength(1);
      const patch = setPayloads[0]!;
      expect(patch.status).toBe('failed');
      expect(patch.errorMessage).toContain('pg_dump failed with code 2');
      expect(patch.durationMs).toBe(3000);
      expect(patch.completedAt).toBeUndefined(); // failed runs stay un-selectable by restore
    });

    it('redacts bound values via the same pipeline as backup-service (#62)', async () => {
      // drizzle's DrizzleQueryError shape — the only place raw values appear.
      const noisy = new Error(
        'Failed query: update "backup_records" set ... where id=$1\nparams: ' +
          JSON.stringify({ password: 'hunter2' }),
      );
      await failRunbookBackupRecord({ id: 'bkp-script-1', error: noisy });

      const stored = setPayloads[0]!.errorMessage as string;
      expect(stored).toContain('Failed query:'); // cause kept…
      expect(stored).not.toContain('hunter2'); // …credentials/bound values dropped
      expect(stored).toContain('bound parameters redacted');
    });

    it('truncates oversized messages so one statement cannot write an unbounded row', async () => {
      await failRunbookBackupRecord({ id: 'bkp-script-1', error: new Error('e'.repeat(600)) });
      const stored = setPayloads[0]!.errorMessage as string;
      expect(stored.length).toBeLessThanOrEqual(540);
      expect(stored).toContain('omitted');
    });

    it('tolerates non-Error throwables', async () => {
      await failRunbookBackupRecord({ id: 'bkp-script-1', error: 'mc cp exited 1' });
      expect(setPayloads[0]!.errorMessage).toContain('mc cp exited 1');
      expect(setPayloads[0]!.status).toBe('failed');
    });
  });
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3275 — a failed backup run leaves evidence, and says which failure it was.
 *
 * The `backup_records` INSERT at the top of `POST /api/cron/backup` ran *outside*
 * the `try` that did all the reporting. So the failure mode that best proves the
 * nightly is broken — the write that would have recorded it — escaped to Next's
 * error boundary: `POST /api/cron/backup?type=full" 500 33` in the access log,
 * with no `backup_records` row, no `logError`, no `error_logs` row and nobody
 * emailed. Meanwhile every cause that *did* reach the catch shared one
 * `error_logs.code`, 'BACKUP_FAILED'.
 *
 * This spec owns the route's two promises: a failure is reported no matter where
 * in the job it happens, and the code in the log row and the alert names the
 * cause. `tests/unit/backup-error-classification-3275.test.ts` owns the mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;

const sent = {
  writes: [] as { table: string; values: Row }[],
  updates: [] as Row[],
  logErrors: [] as { context?: string; metadata?: Record<string, unknown> }[],
  alerts: [] as { subject: string; text: string }[],
  apiErrors: [] as { message: string; status: number }[],
};

/** What the RLS-refused INSERT does to the job: nothing is recorded anywhere. */
let refuseBackupRecords = false;
let insertRows: Row[] = [{ id: 'vm-3275-backup-id' }];
let dumpError: unknown = null;

/** drizzle's node-postgres rethrow: the SQL is the message, the SQLSTATE is in `cause`. */
function rlsRefusal(): Error {
  return Object.assign(new Error('Failed query: insert into "backup_records"("backup_type") values ($1) returning "id" params: full'), {
    name: 'QueryFailedError',
    cause: Object.assign(new Error('permission denied for table backup_records'), { name: 'error', code: '42501' }),
  });
}

vi.mock('@/lib/auth/cron', () => ({ verifyCronSecret: vi.fn(async () => true) }));
vi.mock('@/lib/cron/cron-lock', () => ({ refuseIfCronLockHeld: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async (opts: { context?: string; metadata?: Record<string, unknown> }) => {
    sent.logErrors.push(opts);
  }),
}));
vi.mock('@/lib/email/service', () => ({
  alertSuperAdmin: vi.fn(async (subject: string, text: string) => {
    sent.alerts.push({ subject, text });
    return { success: true, provider: 'unit' };
  }),
}));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    apiError: vi.fn((err: unknown, message = 'Internal server error', status = 500) => {
      sent.apiErrors.push({ message, status });
      return NextResponse.json({ error: message }, { status });
    }),
  };
});
vi.mock('@/lib/db/rls', async () => {
  const { getTableName } = await import('drizzle-orm');
  /** By SQL name, not object identity: two import graphs of the schema give two table objects. */
  const nameOf = (table: unknown) => {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return 'unknown';
    }
  };
  return {
    withSecurityContext: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: (table: unknown) => ({
          values: (values: Row) => {
            const tableName = nameOf(table);
            sent.writes.push({ table: tableName, values });
            const outcome =
              tableName === 'backup_records' && refuseBackupRecords
                ? Promise.reject(rlsRefusal())
                : Promise.resolve(insertRows);
            return {
              returning: () => outcome,
              then: (onOk: unknown, onErr: unknown) => outcome.then(onOk as never, onErr as never),
              catch: (onErr: unknown) => outcome.catch(onErr as never),
            };
          },
        }),
        update: () => ({
          set: (patch: Row) => ({ where: async () => { sent.updates.push(patch); } }),
        }),
      }),
  };
});
vi.mock('@/lib/backups/backup-service', () => {
  class BackupConfigurationError extends Error {
    readonly statusCode = 503;
  }
  return {
    BackupConfigurationError,
    getPgDumpVersion: vi.fn(async () => 'pg_dump (PostgreSQL) 18.6'),
    runPgDump: vi.fn(async () => {
      if (dumpError) throw dumpError;
    }),
  };
});
vi.mock('@/lib/backups/offsite', () => ({
  uploadBackupArtifact: vi.fn(async () => ({ storagePath: 's3://bucket/x.dump', storageType: 's3' })),
  purgeExpiredBackups: vi.fn(async () => ({ deleted: 0, bucket: 'bucket' })),
  resolveRetentionDays: () => 30,
}));
vi.mock('@/lib/storage/s3-config', () => ({ isS3Configured: () => false, describeS3ConfigGap: () => '' }));
vi.mock('@/lib/backups/runtime-fs', () => ({
  ensureDir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  getFileStats: vi.fn(async () => ({ size: 4096 })),
}));
vi.mock('@/lib/backups/integrity', () => ({
  checksumFile: vi.fn(async () => 'ab'.repeat(32)),
  CHECKSUM_ALGORITHM: 'sha256',
}));

async function postUrl(url: string) {
  const { POST } = await import('@/app/api/cron/backup/route');
  return POST(new Request(url, { method: 'POST' }) as unknown as import('next/server').NextRequest);
}

const BACKUP_URL = 'http://localhost/api/cron/backup?type=full';
const rowsFor = (table: string) => sent.writes.filter((w) => w.table === table);

describe('#3275 the backup cron reports every failure it can cause', () => {
  beforeEach(() => {
    vi.resetModules();
    sent.writes.length = 0;
    sent.updates.length = 0;
    sent.logErrors.length = 0;
    sent.alerts.length = 0;
    sent.apiErrors.length = 0;
    refuseBackupRecords = false;
    insertRows = [{ id: 'vm-3275-backup-id' }];
    dumpError = null;
  });

  it('answers a bad ?type= with the code that names it, before touching the database', async () => {
    const res = await postUrl('http://localhost/api/cron/backup?type=../../x');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('BACKUP_TYPE_INVALID');
    expect(sent.writes).toEqual([]);
  });

  it('reports the refused backup_records INSERT instead of escaping to the error boundary', async () => {
    refuseBackupRecords = true;
    const res = await postUrl(BACKUP_URL);

    expect(res.status).toBe(503);
    expect(sent.apiErrors[0]?.message).toMatch(/backup_records/);
    // The three sinks the silent 500 used to miss:
    expect(rowsFor('error_logs').map((w) => w.values.code)).toContain('BACKUP_RECORD_WRITE_REFUSED');
    expect(sent.logErrors.some((l) => l.metadata?.code === 'BACKUP_RECORD_WRITE_REFUSED')).toBe(true);
    expect(sent.alerts.some((a) => a.subject.includes('BACKUP_RECORD_WRITE_REFUSED'))).toBe(true);
    // …and no UPDATE against a row that was never created.
    expect(sent.updates).toEqual([]);
  });

  it('treats an INSERT that returns no row as the record-write cause', async () => {
    insertRows = [];
    const res = await postUrl(BACKUP_URL);

    expect(res.status).toBe(500);
    expect(rowsFor('error_logs').map((w) => w.values.code)).toContain('BACKUP_RECORD_WRITE_FAILED');
    expect(sent.apiErrors[0]?.message).toMatch(/backup_records/);
  });

  it('marks the row failed and names the config cause when the dump role cannot bypass RLS', async () => {
    const { BackupConfigurationError } = await import('@/lib/backups/backup-service');
    dumpError = new BackupConfigurationError(
      'Backup refused: pg_dump role "nucrm" is neither superuser nor BYPASSRLS. Set BACKUP_DATABASE_URL to a connection as a role with BYPASSRLS.',
    );
    const res = await postUrl(BACKUP_URL);

    expect(res.status).toBe(503);
    expect(sent.updates.map((u) => u.status)).toContain('failed');
    expect(rowsFor('error_logs').map((w) => w.values.code)).toContain('BACKUP_CONFIG_REFUSED');
    expect(sent.alerts[0]?.text).toMatch(/BYPASSRLS/);
  });

  it('never puts driver text in the answer, whatever the cause', async () => {
    refuseBackupRecords = true;
    const res = await postUrl(BACKUP_URL);
    const body = await res.json();

    expect(body.error).not.toMatch(/Failed query|params:|permission denied|42501/);
  });
});

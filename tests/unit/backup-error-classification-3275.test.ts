/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3275 — `POST /api/cron/backup` has to say *which* failure it hit.
 *
 * The access log carried `POST /api/cron/backup?type=full 500 33` with nothing in
 * any error sink to explain it, and a 500 that means "the dump role is not
 * BYPASSRLS" (change the env), "pg_dump is not installed" (change the image) and
 * "the database denied the write" (fix the grant) asks for three different
 * operator actions.
 *
 * The classification is checked against the *producers* — the real
 * `runPgDump`/`assertDumpRoleCanReadAllTenants` with `pg` and `child_process`
 * mocked, and drizzle's actual rethrow shape for the SQLSTATE branches. A message
 * that gets reworded out of its branch therefore fails here instead of quietly
 * degrading everything to `BACKUP_FAILED`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const end = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function MockPool() {
    return { query, end, on: vi.fn() };
  });
  return { Pool: MockPool, default: { Pool: MockPool } };
});

const spawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  exec: (_cmd: string, _opts: unknown, cb: (e: null, out: string) => void) =>
    cb(null, 'pg_dump (PostgreSQL) 18.6'),
}));

/** A child that emits nothing and exits `code`, the way a real pg_dump failure does. */
function childThatExits(code: number, stderrText = '') {
  return {
    stderr: { on: (_ev: string, cb: (chunk: string) => void) => { if (stderrText) cb(stderrText); } },
    stdout: { on: vi.fn() },
    on: (event: string, cb: (arg: unknown) => void) => {
      if (event === 'close') setTimeout(() => cb(code), 0);
    },
  };
}

/** A child that fails to spawn at all — ENOENT arrives as an `error` event, not an exit code. */
function childThatCannotSpawn() {
  return {
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    on: (event: string, cb: (arg: unknown) => void) => {
      if (event === 'error') {
        setTimeout(() => cb(Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' })), 0);
      }
    },
  };
}

/** Run a producer that is expected to throw, and classify what it threw. */
async function classifyThrown(action: () => Promise<unknown>) {
  const { classifyBackupError } = await import('@/lib/backups/backup-error');
  try {
    await action();
  } catch (err) {
    return classifyBackupError(err);
  }
  throw new Error('the producer was expected to fail and did not — the classification under test no longer exists');
}

function queryFailure(sqlState: string, sql: string, pgMessage: string) {
  return Object.assign(new Error(`Failed query: ${sql} params: 1`), {
    name: 'QueryFailedError',
    cause: Object.assign(new Error(pgMessage), { name: 'error', code: sqlState }),
  });
}

const DUMP_PATH = '/tmp/nucrm-backups-vm3275/x.dump';

describe('#3275 backup failures are classified by cause', () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    end.mockReset();
    spawn.mockReset();
    process.env['DATABASE_URL'] = 'postgresql://nucrm:secret@db.internal:5432/nucrm';
    delete process.env['BACKUP_DATABASE_URL'];
    process.env['DATABASE_SSL'] = 'false';
    process.env['BACKUP_LOCAL_DIR'] = '/tmp/nucrm-backups-vm3275';
  });

  it('a missing connection string is the configuration branch, and names it', async () => {
    delete process.env['DATABASE_URL'];
    const { runPgDump } = await import('@/lib/backups/backup-service');
    const classified = await classifyThrown(() => runPgDump('full', DUMP_PATH));

    expect(classified!.code).toBe('BACKUP_CONFIG_REFUSED');
    expect(classified!.status).toBe(503);
    expect(classified!.message).toMatch(/DATABASE_URL/);
  });

  it('a role that cannot bypass RLS stays a 503 whose message still names the fix', async () => {
    query.mockResolvedValue({ rows: [{ role: 'nucrm', super: false, bypass: false }] });
    const { runPgDump } = await import('@/lib/backups/backup-service');
    const classified = await classifyThrown(() => runPgDump('full', DUMP_PATH));

    expect(classified!.code).toBe('BACKUP_CONFIG_REFUSED');
    expect(classified!.status).toBe(503);
    expect(classified!.message).toMatch(/BYPASSRLS/);
    expect(classified!.message).toMatch(/BACKUP_DATABASE_URL/);
  });

  it('pg_dump not on the host is its own cause, and not a generic failure', async () => {
    query.mockResolvedValue({ rows: [{ role: 'postgres', super: true, bypass: false }] });
    spawn.mockReturnValue(childThatCannotSpawn());
    const { runPgDump } = await import('@/lib/backups/backup-service');
    const classified = await classifyThrown(() => runPgDump('full', DUMP_PATH));

    expect(classified!.code).toBe('BACKUP_DUMP_BINARY_MISSING');
    expect(classified!.status).toBe(503);
  });

  it('a non-zero pg_dump exit keeps its stderr in the log, out of the body', async () => {
    query.mockResolvedValue({ rows: [{ role: 'postgres', super: true, bypass: false }] });
    spawn.mockReturnValue(childThatExits(1, 'pg_dump: error: connection to server at "db.internal" failed: FATAL password authentication\n'));
    const { runPgDump } = await import('@/lib/backups/backup-service');
    const classified = await classifyThrown(() => runPgDump('full', DUMP_PATH));

    expect(classified!.code).toBe('BACKUP_DUMP_FAILED');
    expect(classified!.status).toBe(500);
    expect(classified!.message).not.toMatch(/password|db.internal|pg_dump:/i);
  });

  it('an RLS refusal on backup_records is the cause that has to be visible', async () => {
    const { classifyBackupError } = await import('@/lib/backups/backup-error');
    const classified = classifyBackupError(
      queryFailure('42501', 'insert into "backup_records"("status") values ($1) returning "id"', 'permission denied for table backup_records'),
    );

    expect(classified.code).toBe('BACKUP_RECORD_WRITE_REFUSED');
    expect(classified.status).toBe(503);
    expect(classified.message).toMatch(/backup_records/);
    expect(classified.message).not.toMatch(/Failed query|params:/);
  });

  it('any other SQLSTATE is a record-write failure, not a permission story', async () => {
    const { classifyBackupError } = await import('@/lib/backups/backup-error');
    const classified = classifyBackupError(
      queryFailure('23505', 'insert into "backup_records"("id") values ($1)', 'duplicate key value violates unique constraint'),
    );

    expect(classified.code).toBe('BACKUP_RECORD_WRITE_FAILED');
    expect(classified.status).toBe(500);
  });

  it('an unrecognised throw is generic, and says nothing about itself', async () => {
    const { classifyBackupError } = await import('@/lib/backups/backup-error');
    const classified = classifyBackupError(new Error('boom: postgresql://nucrm:secret@db.internal/nucrm'));

    expect(classified.code).toBe('BACKUP_FAILED');
    expect(classified.status).toBe(500);
    expect(classified.message).toBe('Backup failed.');
  });

  it('every code it can return is one of the declared ones and is never empty', async () => {
    const { BACKUP_ERROR_CODES } = await import('@/lib/backups/backup-error');
    const known = new Set<string>(Object.values(BACKUP_ERROR_CODES));
    expect(known.size).toBe(Object.keys(BACKUP_ERROR_CODES).length);

    const inputs: unknown[] = [
      new Error('anything at all'),
      queryFailure('42501', 'insert into "backup_records" values ($1)', 'permission denied'),
      Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }),
      new Error('pg_dump failed with code 2: boom'),
    ];
    const { classifyBackupError } = await import('@/lib/backups/backup-error');
    for (const input of inputs) {
      const classified = classifyBackupError(input);
      expect(known.has(classified.code), `undeclared code ${classified.code}`).toBe(true);
      expect(classified.message.length).toBeGreaterThan(10);
      expect(classified.status).toBeGreaterThanOrEqual(400);
    }
  });
});

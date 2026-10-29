import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3255 — `scripts/verify-backup.ts` read `process.env.DATABASE_URL` only, while
 * `lib/backups/backup-service.ts:177` dumps under `BACKUP_DATABASE_URL`. The
 * restore drill needs `CREATEDB` (and BYPASSRLS to read a FORCE-RLS dump back),
 * so on a host that has finished the least-privilege cutover the nightly reported
 * `permission denied to create database` for a perfectly good backup:
 * verification could only ever pass on a host that had NOT done the security work.
 *
 * These tests drive the script's real `spawn`/`Pool` seams with two distinguishable
 * fake DSNs and assert the precedence the dump already uses. No database is
 * contacted; every credential literal here is fake.
 */

const APP = 'postgresql://nucrm_app:FakeAppPassw0rd@app.internal:5432/nucrm';
const BACKUP = 'postgresql://nucrm_backup:FakeBackupPassw0rd@db.internal:5432/nucrm';

const state = vi.hoisted(() => ({
  spawnCalls: [] as { cmd: string; args: string[]; env: Record<string, string> }[],
  poolUrls: [] as string[],
  row: null as unknown,
}));

vi.mock('child_process', () => ({
  spawn: (cmd: string, args: string[], opts: { env?: Record<string, string> } = {}) => {
    state.spawnCalls.push({ cmd, args, env: opts.env ?? {} });
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') setTimeout(() => cb(0), 0);
      },
    };
  },
  exec: (_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
}));

vi.mock('pg', () => {
  const respond = async (sqlText: string) => {
    if (sqlText.includes('FROM backup_records')) return { rows: [state.row] };
    if (sqlText.includes('information_schema.tables')) return { rows: [{ count: '7' }] };
    if (sqlText.includes('FROM users')) return { rows: [{ count: '3' }] };
    return { rows: [] };
  };
  const MockPool = vi.fn(function MockPool(opts: { connectionString: string }) {
    state.poolUrls.push(opts.connectionString);
    return { query: respond, connect: async () => ({ query: respond, release: () => {} }), end: async () => {} };
  });
  return { Pool: MockPool, default: { Pool: MockPool } };
});

import { main } from '../../scripts/verify-backup';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const DUMP_BYTES = 'CREATE TABLE users (id int);\nINSERT INTO users VALUES (1);\n';

let artefactDir = '';
let outLines: string[] = [];
let errLines: string[] = [];

async function runScript(argv: string[] = []) {
  process.argv = [process.execPath, 'vitest-worker-entry', ...argv];
  state.row = {
    id: 'fake-backup-id',
    backup_type: 'full',
    storage_path: path.join(artefactDir, 'nucrm_full_2026-01-01.dump'),
    storage_type: 'local',
    size_bytes: Buffer.byteLength(DUMP_BYTES),
    checksum: createHash('sha256').update(DUMP_BYTES).digest('hex'),
    checksum_algorithm: 'sha256',
    completed_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  await main();
}

describe('verify-backup.ts connection precedence (#3255)', () => {
  beforeEach(() => {
    state.spawnCalls = [];
    state.poolUrls = [];
    outLines = [];
    errLines = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      outLines.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errLines.push(a.map(String).join(' '));
    });
    artefactDir = mkdtempSync(path.join(tmpdir(), 'nucrm-3255-test-'));
    writeFileSync(path.join(artefactDir, 'nucrm_full_2026-01-01.dump'), DUMP_BYTES);
    process.exitCode = 0;
    process.env.DATABASE_URL = APP;
    process.env.BACKUP_DATABASE_URL = BACKUP;
  });

  afterEach(() => {
    rmSync(artefactDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete process.env.BACKUP_DATABASE_URL;
  });

  it('verifies as the role that took the dump, not the app role', async () => {
    await runScript();

    expect(state.poolUrls[0]).toBe(BACKUP);
    expect(state.poolUrls).not.toContain(APP);
    expect(process.exitCode).toBe(0);
  });

  it('creates and validates the scratch database on the backup host', async () => {
    await runScript();

    // The scratch database is made by `CREATE DATABASE` on the pool, then read
    // back on a second pool: both must be the host whose role holds CREATEDB.
    const scratch = new URL(state.poolUrls[1] ?? state.poolUrls[0]);
    expect(scratch.host).toBe('db.internal:5432');
    expect(scratch.pathname).toMatch(/^\/nucrm_verify_\d+$/);
    expect(scratch.username).toBe('nucrm_backup');
    const restore = state.spawnCalls.find((c) => c.cmd === 'pg_restore');
    expect(restore?.env.PGUSER).toBe('nucrm_backup');
    expect(restore?.env.PGPASSWORD).toBe('FakeBackupPassw0rd');
  });

  it('falls back to DATABASE_URL when no backup role is configured', async () => {
    delete process.env.BACKUP_DATABASE_URL;
    await runScript();

    expect(state.poolUrls[0]).toBe(APP);
    expect(process.exitCode).toBe(0);
  });

  it('names both variables when neither is set', async () => {
    delete process.env.BACKUP_DATABASE_URL;
    delete process.env.DATABASE_URL;
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exited ${code}`);
    }) as never);

    await expect(runScript()).rejects.toThrow('exited 1');
    expect(errLines.join('\n')).toMatch(/BACKUP_DATABASE_URL.*DATABASE_URL/);
    expect(errLines.join('\n')).not.toContain('FakeBackupPassw0rd');
    exit.mockRestore();
    process.env.DATABASE_URL = APP;
  });

  it('keeps the credential out of every child argv', async () => {
    await runScript();

    for (const call of state.spawnCalls) {
      expect(call.args.join(' ')).not.toContain('FakeBackupPassw0rd');
      expect(call.args.join(' ')).not.toContain('postgresql://');
    }
  });
});

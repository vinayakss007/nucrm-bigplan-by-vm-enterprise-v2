import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3260 — `scripts/verify-backup.ts` handed the credential-bearing database URL
 * to `psql`/`pg_restore` as a positional argument. argv is world-readable
 * (`ps aux`, `/proc/<pid>/cmdline`), so on the multi-tenant host where this job
 * runs with a BYPASSRLS role, any local process could read a superuser-
 * equivalent DSN.
 *
 * These tests drive the script's real `spawn` seam with a mocked child process
 * and assert the split the fix relies on: argv carries no secret, the child's
 * environment (the libpq PG* vars produced by `pgLibpqEnv()`) carries it.
 * There is no database in this suite — nothing here connects.
 *
 * Every credential below is an obviously fake literal.
 */

const FAKE = vi.hoisted(() => {
  const url =
    'postgresql://nucrm_verify:FakeNotARealPassw0rd@db.internal:5432/nucrm?sslmode=require';
  // The script reads DATABASE_URL at start-up; set it before any module — and
  // any db helper pulled in through the script — evaluates.
  process.env.DATABASE_URL = url;
  return {
    url,
    password: 'FakeNotARealPassw0rd',
    user: 'nucrm_verify',
    host: 'db.internal',
  };
});

const state = vi.hoisted(() => ({
  spawnCalls: [] as { cmd: string; args: string[]; env: Record<string, string> }[],
  exitCode: 0,
  /** Row returned for the `backup_records` lookup; set per test. */
  row: null as unknown,
}));

vi.mock('child_process', () => ({
  spawn: (cmd: string, args: string[], opts: { env?: Record<string, string> } = {}) => {
    state.spawnCalls.push({ cmd, args, env: opts.env ?? {} });
    const code = state.exitCode;
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') setTimeout(() => cb(code), 0);
      },
    };
  },
  // The script imports lib/backups/backup-service, which promisifies `exec` at
  // module load, so the mock has to expose it even though no test reaches it.
  exec: (_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
}));

vi.mock('pg', () => {
  const MockPool = vi.fn(function MockPool() {
    return {
      query: async (sqlText: string) => {
        if (sqlText.includes('FROM backup_records')) return { rows: [state.row] };
        if (sqlText.includes('information_schema.tables')) return { rows: [{ count: '7' }] };
        if (sqlText.includes('FROM users')) return { rows: [{ count: '3' }] };
        return { rows: [] };
      },
      end: async () => {},
    };
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
let artefactPath = '';
let artefactChecksum = '';
let outLines: string[] = [];
let errLines: string[] = [];

/** No argv entry may contain the password, the user:password pair, or a URI. */
function assertArgvClean(call: { cmd: string; args: string[] }) {
  const offending = call.args.filter(
    (a) =>
      a.includes(FAKE.password) ||
      a.includes(`${FAKE.user}:${FAKE.password}`) ||
      a.includes('@' + FAKE.host) ||
      a.includes('@') ||
      a.includes('postgresql://') ||
      a.includes('postgres://')
  );
  expect(offending, `${call.cmd} argv leaked: ${offending.join(' ')}`).toEqual([]);
}

function spawnCallFor(cmd: string) {
  const call = state.spawnCalls.find((c) => c.cmd === cmd);
  if (!call) throw new Error(`${cmd} was never spawned`);
  return call;
}

async function runScript(backupType: string, argv: string[] = []) {
  // argv[1] deliberately does not look like the script path, so importing
  // verify-backup.ts never triggers its own run-on-main guard.
  process.argv = [process.execPath, 'vitest-worker-entry', ...argv];
  state.row = {
    id: 'fake-backup-id',
    backup_type: backupType,
    storage_path: artefactPath,
    storage_type: 'local',
    size_bytes: Buffer.byteLength(DUMP_BYTES),
    checksum: artefactChecksum,
    checksum_algorithm: 'sha256',
    completed_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  await main();
}

describe('verify-backup.ts credential channel (#3260)', () => {
  beforeEach(() => {
    state.spawnCalls = [];
    state.exitCode = 0;
    outLines = [];
    errLines = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      outLines.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errLines.push(a.map(String).join(' '));
    });
    artefactDir = mkdtempSync(path.join(tmpdir(), 'nucrm-3260-test-'));
    artefactPath = path.join(artefactDir, 'nucrm_selective_2026-01-01.sql');
    writeFileSync(artefactPath, DUMP_BYTES);
    artefactChecksum = createHash('sha256').update(DUMP_BYTES).digest('hex');
    // `process.exitCode` is not deletable in the worker, so each run starts
    // from the value a successful verification leaves it at.
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(artefactDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('never puts the credential-bearing URL in psql argv for a plain-SQL dump', async () => {
    await runScript('selective');

    const psql = spawnCallFor('psql');
    assertArgvClean(psql);
    // Behaviour (flags, artefact argument) is unchanged; the only connection
    // detail in argv is the generated scratch database name, which is not a
    // secret and is logged by the script itself.
    expect(psql.args[0]).toMatch(/^nucrm_verify_\d+$/);
    expect(psql.args.slice(1)).toEqual(['-v', 'ON_ERROR_STOP=1', '-f', artefactPath]);
  });

  it('never puts the credential-bearing URL in pg_restore argv for a custom-format dump', async () => {
    await runScript('full');

    const restore = spawnCallFor('pg_restore');
    assertArgvClean(restore);
    expect(restore.args).toEqual([
      '--no-owner',
      '--no-acl',
      '-d',
      expect.stringMatching(/^nucrm_verify_\d+$/),
      artefactPath,
    ]);
  });

  it('supplies the credentials to the child through the libpq PG* environment instead', async () => {
    await runScript('selective');

    const psql = spawnCallFor('psql');
    expect(psql.env.PGPASSWORD).toBe(FAKE.password);
    expect(psql.env.PGUSER).toBe(FAKE.user);
    expect(psql.env.PGHOST).toBe(FAKE.host);
    expect(psql.env.PGPORT).toBe('5432');
    expect(psql.env.PGSSLMODE).toBe('require');
    // The env names the generated scratch database, never production, and it is
    // the channel that carries the secret (argv only ever sees the bare name).
    expect(psql.env.PGDATABASE).toMatch(/^nucrm_verify_\d+$/);
    expect(psql.env.PGDATABASE).not.toBe('nucrm');
  });

  it('keeps the PASS semantics and exit code of a successful verification', async () => {
    await runScript('full');

    const printed = outLines.join('\n');
    expect(printed).toContain('PASS — backup is intact and restorable');
    expect(printed).toContain('ok checksum');
    expect(printed).toContain('ok schema : 7 table(s) restored');
    expect(printed).toContain('ok data   : users rows = 3');
    expect(process.exitCode).toBe(0);
  });

  it('still reports FAIL with a non-zero exit code when the restore child fails', async () => {
    state.exitCode = 1;
    await runScript('full');

    const printed = errLines.join('\n');
    expect(printed).toContain('FAIL — backup verification did not pass');
    expect(printed).toContain('pg_restore exited 1');
    // The failure path must not echo the DSN either.
    expect(printed).not.toContain(FAKE.password);
    expect(process.exitCode).toBe(1);
    assertArgvClean(spawnCallFor('pg_restore'));
  });

  it('honours --checksum-only without spawning a restore at all', async () => {
    await runScript('full', ['--checksum-only']);

    expect(state.spawnCalls).toEqual([]);
    expect(outLines.join('\n')).toContain('PASS (checksum only)');
    expect(process.exitCode).toBe(0);
  });
});

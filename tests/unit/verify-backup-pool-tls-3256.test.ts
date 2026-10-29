import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3256 — both `pg.Pool`s in `scripts/verify-backup.ts` were built as
 * `new Pool({ connectionString, max: 1 })`, with no `ssl`. Every other Postgres
 * connection in this repo goes through `lib/db/ssl-config.ts` (`pool.ts`,
 * `read-replica.ts`, `backups/backup-service.ts`, and the operational scripts
 * `check-schema-drift-live.ts` / `diagnose-production.ts` all pass
 * `ssl: pgSslConfig()`), and that helper exists precisely because five call
 * sites once each decided for themselves and disagreed.
 *
 * The consequence is not a dropped connection on a laptop. `pg` does **not**
 * read `?sslmode=` from a connection string — that parameter belongs to libpq,
 * which is what `psql`/`pg_restore` speak, reached here through
 * `pgLibpqEnv()`. So once `pg_hba.conf` is switched to `hostssl`, the restore
 * child reads TLS from the URL and succeeds, while the *validation* query the
 * script runs afterwards on its own pool tries plaintext, dies with
 * `no pg_hba.conf entry for host … no encryption`, and a perfectly good dump is
 * reported FAIL. The backup is fine; the tool that proves it isn't.
 *
 * These tests drive the script's real `main()` through the same mocked `pg` +
 * `child_process` seams `verify-backup-argv-3260.test.ts` uses, and read the
 * options each Pool was constructed with. There is no database here — nothing
 * connects, and every credential is an obviously fake literal.
 */

const FAKE = vi.hoisted(() => {
  const url =
    'postgresql://nucrm_verify:FakeNotARealPassw0rd@db.internal:5432/nucrm?sslmode=require';
  process.env.DATABASE_URL = url;
  return { url, password: 'FakeNotARealPassw0rd', host: 'db.internal' };
});

const state = vi.hoisted(() => ({
  exitCode: 0,
  row: null as unknown,
  /** Every options object `scripts/verify-backup.ts` handed to `new Pool(...)`. */
  poolOptions: [] as Record<string, unknown>[],
  /** When set, the scratch-pool validation query rejects with this message. */
  validationError: '' as string,
}));

vi.mock('child_process', () => ({
  spawn: () => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: (event: string, cb: (arg: unknown) => void) => {
      if (event === 'close') setTimeout(() => cb(state.exitCode), 0);
    },
  }),
  exec: (_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
}));

vi.mock('pg', () => {
  const respond = async (sqlText: string) => {
    if (sqlText.includes('FROM backup_records')) return { rows: [state.row] };
    if (sqlText.includes('information_schema.tables')) {
      if (state.validationError) throw new Error(state.validationError);
      return { rows: [{ count: '7' }] };
    }
    if (sqlText.includes('FROM users')) return { rows: [{ count: '3' }] };
    return { rows: [] };
  };
  const MockPool = vi.fn(function MockPool(options: Record<string, unknown> = {}) {
    state.poolOptions.push(options);
    return {
      query: respond,
      connect: async () => ({ query: respond, release: () => {} }),
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

async function runScript(backupType = 'full', argv: string[] = []) {
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

describe('#3256 verify-backup.ts pools carry the repo TLS policy', () => {
  beforeEach(() => {
    state.exitCode = 0;
    state.poolOptions = [];
    state.validationError = '';
    outLines = [];
    errLines = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      outLines.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errLines.push(a.map(String).join(' '));
    });
    artefactDir = mkdtempSync(path.join(tmpdir(), 'nucrm-3256-test-'));
    artefactPath = path.join(artefactDir, 'nucrm_full_2026-01-01.dump');
    writeFileSync(artefactPath, DUMP_BYTES);
    artefactChecksum = createHash('sha256').update(DUMP_BYTES).digest('hex');
    process.exitCode = 0;
    vi.stubEnv('DATABASE_SSL', '');
    vi.stubEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    rmSync(artefactDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('builds both pools — the source pool and the scratch-verification pool', async () => {
    await runScript();
    expect(state.poolOptions).toHaveLength(2);
    expect(state.poolOptions[0]).toMatchObject({ connectionString: FAKE.url, max: 1 });
    expect(String(state.poolOptions[1].connectionString)).toMatch(/^postgresql:\/\//);
    expect(state.poolOptions[1]).toMatchObject({ max: 1 });
  });

  it('gives EVERY pool it builds an ssl option, so no connection opts out by omission', async () => {
    await runScript();
    expect(state.poolOptions.length).toBeGreaterThan(0);
    for (const options of state.poolOptions) {
      expect(options).toHaveProperty('ssl');
      expect(options.ssl, 'an omitted ssl is node-pg for "plaintext"').toBeDefined();
    }
  });

  it('uses the shared policy, not a hand-rolled literal: verify on by default', async () => {
    await runScript();
    for (const options of state.poolOptions) {
      expect(options.ssl).toEqual({ rejectUnauthorized: false });
    }
  });

  it('verifies the server certificate in production, the way lib/db/pool.ts does', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await runScript();
    for (const options of state.poolOptions) {
      expect(options.ssl).toEqual({ rejectUnauthorized: true });
    }
  });

  it('honours the DATABASE_SSL=false escape hatch on both pools', async () => {
    vi.stubEnv('DATABASE_SSL', 'false');
    await runScript();
    for (const options of state.poolOptions) {
      expect(options.ssl).toBe(false);
    }
  });

  it('honours DATABASE_SSL_REJECT_UNAUTHORIZED=false as the explicit opt-out of verification', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', 'false');
    await runScript();
    for (const options of state.poolOptions) {
      expect(options.ssl).toEqual({ rejectUnauthorized: false });
    }
  });

  it('does not let the URL query string be the only TLS channel: sslmode=require alone does not make the pool plaintext-safe-by-policy', async () => {
    // node-pg ignores `?sslmode=`; libpq (the restore child) obeys it. Pinning
    // this keeps the two channels from silently diverging again.
    expect(FAKE.url).toContain('sslmode=require');
    vi.stubEnv('DATABASE_SSL', 'false');
    await runScript();
    for (const options of state.poolOptions) {
      expect(options.ssl).toBe(false);
    }
    vi.stubEnv('DATABASE_SSL', '');
    state.poolOptions = [];
    await runScript();
    for (const options of state.poolOptions) {
      expect(options.ssl).toEqual({ rejectUnauthorized: false });
    }
  });

  it('still hands the restore child the URL-derived PGSSLMODE, so the child channel is untouched', async () => {
    await runScript();
    const printed = outLines.join('\n');
    expect(printed).toContain('ok checksum');
    expect(printed).toContain('PASS — backup is intact and restorable');
    expect(process.exitCode).toBe(0);
  });

  it('keeps reporting FAIL, and does not print a credential, when the validation query itself fails', async () => {
    // The shape of the original incident: the restore child obeyed
    // `?sslmode=require` and succeeded, the script's own pool did not ask for
    // TLS at all, and Postgres answered
    // `no pg_hba.conf entry for host "…" (required no encryption)`. The verdict
    // must be FAIL with the cause named — and the DSN, which contains the
    // password that error would have had to reach, stays out of the output.
    state.validationError =
      'FATAL: no pg_hba.conf entry for host "10.0.0.7", user "nucrm_verify", database "nucrm_verify_1", SSL required (no encryption)';
    await runScript();

    const printed = `${outLines.join('\n')}\n${errLines.join('\n')}`;
    expect(printed).toContain('FAIL');
    expect(printed).toContain('no pg_hba.conf entry');
    expect(printed).not.toContain(FAKE.password);
    expect(process.exitCode).toBe(1);
  });

  it('spends the scratch pool only on the restored database, never on the source URL', async () => {
    await runScript();
    const scratch = String(state.poolOptions[1].connectionString);
    expect(scratch).not.toBe(FAKE.url);
    expect(scratch).toMatch(/\/nucrm_verify_\d+(\?|$)/);
  });
});

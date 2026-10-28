import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Issue #2600 — the alert lifecycle of /api/cron/backup-verify.
 *
 * Live state when this was filed: 19 unresolved rows in backup_alerts, of which 13
 * were `no_backup_to_verify` written by this route, one per nightly 500. Nothing
 * resolved them: the repo's only `resolved = true` write for this table sat in
 * app/api/cron/backup (no line in deploy/cron/crontab) and filtered
 * alert_type = 'no_backup', so the verify-family types were unresolvable by
 * construction — even a restore that proved the backup good left them open.
 *
 * Also pinned here: a FAILED verification answers 5xx. It used to answer 200 with
 * `ok: false` in the body, and both schedulers read status only, which made a
 * corrupt artefact look greener than an empty table.
 */

const dialect = new PgDialect();

type Insert = { table: string; values: unknown };
type Update = { table: string; set: Record<string, unknown>; where: unknown };

let inserts: Insert[] = [];
let updates: Update[] = [];

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: (table: Parameters<typeof getTableName>[0]) => ({
        values: (values: unknown) => {
          inserts.push({ table: getTableName(table), values });
          return Promise.resolve({ rows: [] });
        },
      }),
      update: (table: Parameters<typeof getTableName>[0]) => {
        const rec: Update = { table: getTableName(table), set: {}, where: undefined };
        const chain = {
          set: (s: Record<string, unknown>) => { rec.set = s; return chain; },
          where: (w: unknown) => { rec.where = w; updates.push(rec); return Promise.resolve({ rows: [] }); },
        };
        return chain;
      },
    }),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
// #3298: this route authenticates through lib/auth/cron rather than comparing the
// secret itself, so that is the module to stub. Allow/deny semantics are pinned in
// auth-cron-verify-secret.test.ts, the denial record in cron-task-reminders.test.ts,
// and that the route reaches them at all is pinned in cron-auth-screen-3298.test.ts.
// What this spec owns is the job's own logic.
vi.mock('@/lib/auth/cron', () => ({ verifyCronSecret: vi.fn(async () => true) }));
vi.mock('@/lib/cron/cron-lock', () => ({ refuseIfCronLockHeld: vi.fn(async () => null) }));
vi.mock('@/lib/email/service', () => ({ alertSuperAdmin: vi.fn(async () => {}) }));
vi.mock('@/lib/backups/backup-service', () => ({ pgLibpqEnv: (u: string) => ({ PGURL: u }) }));
vi.mock('@/lib/db/ssl-config', () => ({ pgSslConfig: () => undefined }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => Response.json({ error: String(err) }, { status: 500 }),
}));

/**
 * The scratch-database reads: [0] the completed-backup lookup, then the pooled
 * count queries inside the restore. `openAlertQueue` answers
 * db.query.backupAlerts.findFirst (the duplicate-alert guard), one entry per
 * recordFailure call.
 */
let selectQueue: unknown[][] = [];
let openAlertQueue: unknown[] = [];
let restoreExitCode = 0;

vi.mock('pg', () => ({
  Pool: class MockPool {
    async query(sqlText: string) {
      if (/information_schema\.tables/i.test(sqlText)) return { rows: [{ count: '5' }] };
      if (/from tenants/i.test(sqlText)) return { rows: [{ count: '1' }] };
      return { rows: [] };
    }
    async end() {}
  },
}));

vi.mock('child_process', () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from('pg_restore: error: corrupted dump file'));
      child.emit('close', restoreExitCode);
    });
    return child;
  },
}));

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdtempSync: () => '/tmp/nucrm-bkv-test',
  rmSync: () => {},
  createReadStream: () => {
    const stream = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
    queueMicrotask(() => {
      stream.emit('data', Buffer.from('dump-bytes'));
      stream.emit('end');
    });
    return stream;
  },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
      return chain;
    },
    query: {
      backupAlerts: {
        findFirst: vi.fn(async () => openAlertQueue.shift()),
      },
    },
  },
}));

const { POST } = await import('@/app/api/cron/backup-verify/route');

function makeRequest() {
  return new Request('http://localhost/api/cron/backup-verify', {
    method: 'POST',
    headers: { 'x-cron-secret': 'irrelevant-mocked' },
  }) as unknown as import('next/server').NextRequest;
}

const COMPLETED_BACKUP = {
  id: 'b-1',
  backupType: 'full',
  storagePath: '/var/backups/nucrm-latest.dump',
  storageType: 'local',
  checksum: null,
  completedAt: new Date('2026-10-13T02:00:00Z'),
};

beforeEach(() => {
  inserts = [];
  updates = [];
  selectQueue = [];
  openAlertQueue = [];
  restoreExitCode = 0;
  process.env.DATABASE_URL = 'postgresql://nucrm@localhost:5432/nucrm';
  delete process.env.BACKUP_DATABASE_URL;
});

describe('cron/backup-verify — a passing run closes the alerts it owns', () => {
  it('resolves the three verify-family alert types', async () => {
    selectQueue = [[COMPLETED_BACKUP]];
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, backup_id: 'b-1', checksum_match: true });

    const alertUpdate = updates.find((u) => u.table === 'backup_alerts');
    expect(alertUpdate, 'a passing verification must resolve the alert trail').toBeDefined();
    expect(alertUpdate!.set).toMatchObject({ resolved: true });
    expect(alertUpdate!.set.resolvedAt).toBeInstanceOf(Date);
    const sql = dialect.sqlToQuery(alertUpdate!.where as never).sql.replace(/\s+/g, ' ');
    expect(sql).toMatch(/"backup_alerts"\."resolved" = \$1/i);
    // The verify taxonomy only — no_backup belongs to cron/backup, which proves a
    // dump happened; a passing restore must not claim that on its behalf.
    expect(dialect.sqlToQuery(alertUpdate!.where as never).params).toEqual([
      false, 'no_backup_to_verify', 'verify_failed', 'verify_error',
    ]);
    expect(sql).toMatch(/"alert_type" in \(\$2, \$3, \$4\)/i);
    expect(inserts.filter((i) => i.table === 'backup_alerts')).toHaveLength(0);
  });

  it('still writes backup_records.last_verified_at so the proof is durable', async () => {
    selectQueue = [[COMPLETED_BACKUP]];
    await POST(makeRequest());
    const recordUpdate = updates.find((u) => u.table === 'backup_records');
    expect(recordUpdate!.set.verifiedOk).toBe(true);
    expect(recordUpdate!.set.verifyError).toBeNull();
  });
});

describe('cron/backup-verify — a failing run is loud and does not pile up', () => {
  it('answers 5xx when the restore fails, and resolves nothing', async () => {
    restoreExitCode = 1;
    selectQueue = [[COMPLETED_BACKUP]];
    openAlertQueue = [undefined]; // no alert of this type open yet
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.cause).toBe('verify_failed');
    expect(body.failures[0]).toContain('Restore failed (exit 1)');
    expect(updates.find((u) => u.table === 'backup_alerts')).toBeUndefined();
    expect(inserts.find((i) => i.table === 'backup_alerts')).toMatchObject({
      values: { alertType: 'verify_failed' },
    });
  });

  it('does not insert a second unresolved alert while one of the same type is open', async () => {
    restoreExitCode = 1;
    selectQueue = [[COMPLETED_BACKUP]];
    openAlertQueue = [{ id: 'alert-1' }]; // the nightly 500 has already recorded this
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(inserts.filter((i) => i.table === 'backup_alerts')).toHaveLength(0);
  });

  it('records no_backup_to_verify once, not once per night, for a missing artefact', async () => {
    selectQueue = [[], [{ backupType: 'full', status: 'failed', errorMessage: 'BYPASSRLS', createdAt: new Date() }]];
    openAlertQueue = [{ id: 'alert-2' }];
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).cause).toBe('no_backup_to_verify');
    expect(inserts.filter((i) => i.table === 'backup_alerts')).toHaveLength(0);
  });
});

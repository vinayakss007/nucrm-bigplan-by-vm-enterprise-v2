/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2393 — a deleted tenant must not keep being backed up.
 *
 * Tenant deletion is a tombstone UPDATE (`status='suspended'`, `deleted_at`),
 * so `backup_schedules … ON DELETE cascade` never fires and the gone tenant's
 * schedule stays `enabled = true`. The cron then re-exports it, writes a whole
 * `tenant_backup_records` row per tick, and pages the super admin if the export
 * fails — about a customer that no longer exists.
 *
 * Asserting on a mocked return value proves nothing about a WHERE clause, so
 * every predicate check here RENDERS the statement (`PgDialect().sqlToQuery`)
 * and inspects the SQL text plus its bound params. Inertness is proved by
 * counting recorded calls: for a tombstoned tenant the INSERT and the alert
 * email must be at zero. And because "nothing is ever backed up" is also a way
 * to get zeros, each inertness test sits next to a live control that must
 * still export — and must still page for an orphaned LIVE tenant (#2127).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { backupSchedules, tenants } from '@/drizzle/schema';

const DEAD_TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LIVE_TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORPHAN_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const h = vi.hoisted(() => ({
  executes: [] as unknown[],
  // tenant id → the row `SELECT id, owner_id, status, deleted_at FROM tenants`
  // finds. An absent key = zero rows, i.e. the tenant was hard-erased.
  tenantRows: {} as Record<string, Record<string, unknown>>,
  scheduleRows: [] as Record<string, unknown>[],
  memberRows: [] as Record<string, unknown>[],
  globalTenantRows: [] as Record<string, unknown>[],
  globalScheduleExists: [] as Record<string, unknown>[],
  txUpdates: [] as Array<{ table: unknown; payload: Record<string, unknown>; where: unknown }>,
  topLevelUpdates: [] as Array<{ table: unknown; payload: Record<string, unknown>; where: unknown }>,
}));

const dialect = new PgDialect();
function render(node: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
  // Templates begin with the newline after the backtick; trim so `^SELECT`
  // means "this statement" rather than "no leading whitespace in the source".
  return { sql: q.sql.trim(), params: q.params ?? [] };
}
function sqlOf(node: unknown): string {
  return render(node).sql;
}
/** Every recorded `db.execute` statement whose SQL matches `re`. */
function select(re: RegExp): Array<{ sql: string; params: unknown[] }> {
  return h.executes.map(render).filter((r) => re.test(r.sql));
}

const mockExecute = vi.fn((node: unknown) => {
  h.executes.push(node);
  const { sql, params } = render(node);

  if (/^SELECT s\.\* FROM backup_schedules/s.test(sql)) {
    return Promise.resolve({ rows: h.scheduleRows, rowCount: h.scheduleRows.length });
  }
  if (/FROM backup_schedules WHERE tenant_id IS NULL/.test(sql)) {
    return Promise.resolve({ rows: h.globalScheduleExists, rowCount: h.globalScheduleExists.length });
  }
  if (/^INSERT INTO backup_schedules/s.test(sql)) {
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (/^SELECT id FROM tenants\s+WHERE/s.test(sql)) {
    return Promise.resolve({ rows: h.globalTenantRows, rowCount: h.globalTenantRows.length });
  }
  if (/owner_id, status, deleted_at FROM tenants WHERE id/.test(sql)) {
    const row = h.tenantRows[String(params[0])];
    return Promise.resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  }
  if (/FROM tenant_members/.test(sql)) {
    return Promise.resolve({ rows: h.memberRows, rowCount: h.memberRows.length });
  }
  if (/^INSERT INTO tenant_backup_records/.test(sql)) {
    return Promise.resolve({ rows: [{ id: 'backup-1' }], rowCount: 1 });
  }
  if (/^SELECT name FROM tenants WHERE id/.test(sql)) {
    return Promise.resolve({ rows: [{ name: 'Gone Co' }], rowCount: 1 });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
});

/** drizzle's update chain is a thenable; `where()` must stay awaitable. */
function updateChain(table: unknown, sink: Array<{ table: unknown; payload: Record<string, unknown>; where: unknown }>) {
  const rec = { table, payload: {} as Record<string, unknown>, where: undefined as unknown };
  sink.push(rec);
  const chain: Record<string, unknown> = {
    set: (p: Record<string, unknown>) => { Object.assign(rec.payload, p); return chain; },
    where: (w: unknown) => { rec.where = w; return chain; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve([]).catch(rej),
  };
  return chain;
}

vi.mock('@/drizzle/db', () => {
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => [],
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej),
  };
  const tx = {
    update: (table: unknown) => updateChain(table, h.txUpdates),
    execute: (node: unknown) => mockExecute(node),
    delete: () => selectChain,
  };
  const db: Record<string, unknown> = {
    execute: (node: unknown) => mockExecute(node),
    update: (table: unknown) => updateChain(table, h.topLevelUpdates),
    select: () => selectChain,
    query: {},
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  };
  return { db };
});

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));

vi.mock('@/lib/auth/cron', () => ({ verifyCronSecret: async () => true }));
vi.mock('@/lib/cache', () => ({
  acquireLock: async () => ({ acquired: true }),
  invalidateTenantCache: vi.fn(async () => {}),
  cache: { get: async () => null, set: async () => {}, del: async () => {} },
}));
vi.mock('@/lib/db/rls', () => ({
  setSuperAdminContext: vi.fn(async () => {}),
  setTenantContext: vi.fn(async () => {}),
  withTenantContext: vi.fn(async (_t: unknown, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));

const sendAlertEmailMock = vi.fn(async () => {});
vi.mock('@/lib/email/alerts', () => ({
  sendAlertEmail: (subject: string, message: string) => sendAlertEmailMock(subject, message),
}));

const exportAllMock = vi.fn(async () => ({
  dataSize: 1, tableCount: 1, totalRecords: 1, tables: {},
}));
const exporterCtorMock = vi.fn(function () {
  return { exportAll: exportAllMock };
});
vi.mock('@/lib/tenant-data-export', () => ({
  TenantDataExporter: exporterCtorMock,
}));

// ── superadmin/tenants: cancel-on-delete shares this file's module graph ──────

vi.mock('@/lib/api/validate', () => ({
  validateBody: () => null,
  readJsonBody: async (req: { json: () => Promise<unknown> }) => await req.json(),
}));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: vi.fn(async () => {}) }));
vi.mock('@/lib/queue', () => ({ addJob: vi.fn(async () => {}) }));
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: async () => null,
  concurrencyGuardById: async () => null,
  updatedAtMs: () => undefined,
  checkStaleUpdate: () => null,
}));
vi.mock('@/lib/api-error', () => ({
  // Fail loudly: a handler that throws must not be mistaken for a pass.
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));
vi.mock('@/lib/auth/session', () => ({ hashPassword: () => 'x', verifyPassword: async () => true }));
vi.mock('@/lib/tenants/provision', () => ({ provisionTenantWorkspace: vi.fn(async () => {}) }));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn(async () => {}) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({
    userId: '22222222-2222-4222-8222-222222222222',
    tenantId: '11111111-1111-4111-8111-111111111111',
    email: 'sa@example.com',
    isSuperAdmin: true,
    user: { email: 'sa@example.com' },
  }),
}));

const LIVE_ROW = { owner_id: 'user-1', status: 'trialing', deleted_at: null };
const TOMBSTONED_ROW = {
  owner_id: 'user-1', status: 'suspended', deleted_at: new Date('2026-01-01T00:00:00Z'),
};
// The tenant #2393 singles out: deleted, but still fully staffed (owner and an
// active membership). Under the old code the skip/no-skip answer came out of
// the membership probe, so two deleted tenants behaved differently and this one
// got a real export.

function schedule(tenantId: string | null) {
  return {
    id: 's1', tenant_id: tenantId, schedule_type: 'daily',
    backup_type: 'full', retention_days: 90,
  };
}

async function runCron() {
  const { POST } = await import('@/app/api/cron/auto-backup/route');
  const res = await POST({ headers: new Map() } as unknown as NextRequest);
  return { res, body: await res.json() };
}

function delReq(body: unknown) {
  return new Request('http://localhost/api/superadmin/tenants', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.executes = [];
  h.tenantRows = {};
  h.scheduleRows = [];
  h.memberRows = [];
  h.globalTenantRows = [];
  h.globalScheduleExists = [];
  h.txUpdates = [];
  h.topLevelUpdates = [];
});

// ── (a) the selection itself is tenant-aware ─────────────────────────────────

describe('schedule selection SQL (#2393)', () => {
  it('filters per-tenant schedules on tenant liveness, and on the schedule tombstone', async () => {
    h.scheduleRows = []; // nothing due → the run ends after the probe
    h.globalScheduleExists = [{ x: 1 }];

    await runCron();

    const text = sqlOf(h.executes[0]);
    // The schedule's OWN lifecycle column — supplied by the utils.lifecycle()
    // spread, which is why grepping for `deletedAt:` never found it.
    expect(text).toMatch(/s\."?deleted_at"?\s+IS\s+NULL/i);
    // Tenant liveness as an EXISTS: a LEFT JOINed missing tenant row makes
    // `t.deleted_at IS NULL` evaluate true, which is the opposite of the answer.
    expect(text).toMatch(/EXISTS\s*\(\s*SELECT/si);
    expect(text).toMatch(/FROM tenants t/i);
    expect(text).toMatch(/t\."?deleted_at"?\s+IS\s+NULL/i);
    expect(text).toMatch(/t\."?status"?\s+NOT IN/si);
    expect(text).not.toMatch(/LEFT JOIN/i);
    // A platform-wide schedule (tenant_id IS NULL) must stay eligible.
    expect(text).toMatch(/s\."?tenant_id"?\s+IS\s+NULL\s+OR/si);
  });

  it('binds both gone-status spellings instead of comparing to suspended only', async () => {
    h.globalScheduleExists = [{ x: 1 }];
    await runCron();
    const { params } = render(h.executes[0]);
    expect(params).toContain('suspended');
    expect(params).toContain('deleted');
  });

  it('the global branch lists tenants by deleted_at, not by status alone', async () => {
    h.scheduleRows = [schedule(null)];
    h.globalTenantRows = [{ id: LIVE_TENANT }, { id: DEAD_TENANT }, { id: OTHER_TENANT }];
    h.tenantRows = {
      [LIVE_TENANT]: LIVE_ROW,
      [DEAD_TENANT]: TOMBSTONED_ROW,
      [OTHER_TENANT]: { owner_id: 'user-1', status: 'deleted', deleted_at: null },
    };
    h.memberRows = [{ user_id: 'user-1' }];

    const { body } = await runCron();

    const list = select(/^SELECT id FROM tenants\s+WHERE/s);
    expect(list).toHaveLength(1);
    expect(list[0].sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(list[0].sql).toMatch(/status NOT IN/si);
    expect(list[0].params).toContain('suspended');
    expect(list[0].params).toContain('deleted');

    // Only the live tenant was exported; the two gone ones got no record.
    expect(exportAllMock).toHaveBeenCalledTimes(1);
    expect(exporterCtorMock.mock.calls[0][0]).toBe(LIVE_TENANT);
    expect(body.scheduled.errors).toBe(0);
  });

  it('the default-schedule existence probe ignores a tombstoned global schedule', async () => {
    h.scheduleRows = [];
    h.globalScheduleExists = []; // no LIVE global schedule → the default returns

    const { body } = await runCron();

    const probe = select(/FROM backup_schedules WHERE tenant_id IS NULL/s);
    expect(probe).toHaveLength(1);
    expect(probe[0].sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(body.scheduled.message).toBe('Created default monthly backup schedule');
    expect(select(/^INSERT INTO backup_schedules/s)).toHaveLength(1);
  });
});

// ── (b) a stale schedule is inert ────────────────────────────────────────────

describe('stale per-tenant schedule (#2393)', () => {
  // The belt-and-braces layer: even if a tombstoned tenant's schedule reaches
  // the loop (a row inserted before this fix, a restore that re-opened a
  // tenant, a future writer that forgets the cancel), no export may happen.
  it('writes no backup record and sends no alert for a deleted tenant — even a fully staffed one', async () => {
    h.scheduleRows = [schedule(DEAD_TENANT)];
    h.tenantRows = { [DEAD_TENANT]: TOMBSTONED_ROW };
    h.memberRows = [{ user_id: 'user-1' }];

    const { body } = await runCron();

    expect(select(/^INSERT INTO tenant_backup_records/s)).toHaveLength(0);
    expect(exportAllMock).not.toHaveBeenCalled();
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
    expect(body.scheduled.skipped).toBe(1);
    // #2127's page is for INCOMPLETE backups. A deleted tenant is not one.
    expect(body.scheduled.skippedTenants).toEqual([]);
    expect(body.scheduled.errors).toBe(0);
    // The doomed schedule must not stay due forever.
    expect(select(/^UPDATE backup_schedules SET last_run_at/s)).toHaveLength(1);
  });

  it('checks liveness before membership, so a deleted tenant never reaches the member probe', async () => {
    // owner_id NULL is what used to send the run to tenant_members: the old
    // answer came from membership, not from `deleted_at`.
    h.scheduleRows = [schedule(DEAD_TENANT)];
    h.tenantRows = { [DEAD_TENANT]: { owner_id: null, status: 'suspended', deleted_at: TOMBSTONED_ROW.deleted_at } };
    h.memberRows = [{ user_id: 'user-1' }];

    const { body } = await runCron();

    expect(select(/FROM tenant_members/s)).toHaveLength(0);
    expect(exportAllMock).not.toHaveBeenCalled();
    expect(body.scheduled.skipped).toBe(1);
  });

  it('treats a hard-erased tenant as deleted rather than exporting nothing for it', async () => {
    h.scheduleRows = [schedule(DEAD_TENANT)];
    h.tenantRows = {}; // the probe finds zero rows

    const { body } = await runCron();

    expect(body.scheduled.skipped).toBe(1);
    expect(body.scheduled.skippedTenants).toEqual([]);
    expect(exportAllMock).not.toHaveBeenCalled();
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  it('a status-only "deleted" with no tombstone is still gone', async () => {
    h.scheduleRows = [schedule(DEAD_TENANT)];
    h.tenantRows = { [DEAD_TENANT]: { owner_id: 'user-1', status: 'deleted', deleted_at: null } };

    const { body } = await runCron();

    expect(exportAllMock).not.toHaveBeenCalled();
    expect(body.scheduled.skipped).toBe(1);
  });

  // Load-bearing control: without it every assertion above would also pass on
  // a cron that simply never backs anybody up.
  it('still backs up a live tenant, and still pages for an orphaned one', async () => {
    h.scheduleRows = [schedule(LIVE_TENANT), schedule(ORPHAN_TENANT)];
    h.tenantRows = {
      [LIVE_TENANT]: LIVE_ROW,
      [ORPHAN_TENANT]: { owner_id: null, status: 'trialing', deleted_at: null },
    };
    h.memberRows = [];

    const { body } = await runCron();

    expect(exportAllMock).toHaveBeenCalledTimes(1);
    expect(select(/^INSERT INTO tenant_backup_records/s)).toHaveLength(1);
    // #2127 must survive: an orphaned LIVE tenant IS an incomplete backup.
    expect(body.scheduled.skippedTenants).toEqual([ORPHAN_TENANT]);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
    expect(sendAlertEmailMock.mock.calls[0][0]).toContain('1 tenant(s) skipped');
  });
});

// ── cancel on delete ─────────────────────────────────────────────────────────

describe('DELETE /api/superadmin/tenants (#2393)', () => {
  it('disables the tenant backup schedules in the same transaction as the tombstone', async () => {
    const { DELETE } = await import('@/app/api/superadmin/tenants/route');
    const res = await DELETE(delReq({ id: DEAD_TENANT }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Both writes went through ONE transaction, so a crash cannot tombstone the
    // tenant and leave its schedule enabled.
    expect(h.topLevelUpdates).toHaveLength(0);
    expect(h.txUpdates).toHaveLength(2);
    expect(h.txUpdates[0].table).toBe(tenants);
    expect(h.txUpdates[0].payload.status).toBe('suspended');
    expect(h.txUpdates[0].payload.deletedAt).toBeInstanceOf(Date);

    const sched = h.txUpdates[1];
    expect(sched.table).toBe(backupSchedules);
    expect(sched.payload.enabled).toBe(false);
    expect(sched.payload.deletedAt).toBeInstanceOf(Date);

    const where = render(sched.where);
    expect(where.sql).toMatch(/deleted_at"?\s+IS\s+NULL/i);
    expect(where.params).toContain(DEAD_TENANT);
  });

  it('scopes the cancel to that tenant, so the platform-wide schedule survives', async () => {
    const { DELETE } = await import('@/app/api/superadmin/tenants/route');
    await DELETE(delReq({ id: OTHER_TENANT }));

    const sched = h.txUpdates.find((u) => u.table === backupSchedules);
    expect(sched).toBeDefined();
    const where = render(sched!.where);
    // tenant_id = $n, never `tenant_id IS NULL` — NULL is the global schedule.
    expect(where.sql).toMatch(/"tenant_id"\s*=\s*\$/);
    expect(where.sql).not.toMatch(/tenant_id"?\s+IS\s+NULL/i);
    expect(where.params).toEqual([OTHER_TENANT]);
  });
});

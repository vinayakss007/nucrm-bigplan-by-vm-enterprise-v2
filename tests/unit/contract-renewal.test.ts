import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { contracts, activities, users } from '@/drizzle/schema';

// The route modules under test are also imported by the pre-existing checks
// below, so every mock keeps the original module and overrides only the
// functions this suite must not let run (network, SMTP, database).
const mockAcquireLock = vi.fn(async () => ({ acquired: true }));
vi.mock('@/lib/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cache')>()),
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
}));

vi.mock('@/lib/crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crypto')>()),
  verifySecret: () => true,
}));

vi.mock('@/lib/errors-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/errors-server')>()),
  logError: vi.fn(async () => {}),
}));

vi.mock('@/lib/api-error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-error')>()),
  apiError: vi.fn(() => NextResponse.json({ error: 'Internal error' }, { status: 500 })),
}));

const mockCreateNotification = vi.fn(async () => true);
vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications')>()),
  createNotification: (opts: unknown) => mockCreateNotification(opts),
}));

const mockSendEmail = vi.fn(async () => ({ id: 'msg-1' }));
vi.mock('@/lib/email/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/service')>()),
  sendEmail: (opts: unknown) => mockSendEmail(opts),
}));

// The sweep itself is covered by tests/unit/cron-tenant-scope.test.ts; here it is
// stubbed so the body runs once for a fixed tenant and the route's own
// accumulation/reporting is what is under test.
const mockSweepTenants = vi.fn(async (_context: string, body: (tenantId: string) => Promise<void>) => {
  for (const tenantId of sweptTenants) {
    await body(tenantId);
  }
  return sweepResult;
});
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (tenantId: string) => Promise<void>) => mockSweepTenants(context, body),
}));

type SelectCall = { table: unknown; where: unknown };
type UpdateCall = { table: unknown; payload: unknown; where: unknown };
type InsertCall = { table: unknown; values: unknown };

const selectCalls: SelectCall[] = [];
const updates: UpdateCall[] = [];
const inserts: InsertCall[] = [];
// Reads answer from this table-keyed stub, so each test decides what its rows are.
const rowsByTable = new Map<unknown, unknown[]>();
let returningRows: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const call: SelectCall = { table: undefined, where: undefined };
      selectCalls.push(call);
      const chain: Record<string, unknown> = {
        from: (table: unknown) => {
          call.table = table;
          return chain;
        },
        where: (where: unknown) => {
          call.where = where;
          return chain;
        },
        innerJoin: () => chain,
        limit: () => chain,
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(rowsByTable.get(call.table) ?? []).then(onFulfilled, onRejected),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => {
      const call: UpdateCall = { table, payload: undefined, where: undefined };
      updates.push(call);
      const chain: Record<string, unknown> = {
        set: (payload: unknown) => {
          call.payload = payload;
          return chain;
        },
        where: (where: unknown) => {
          call.where = where;
          return chain;
        },
        returning: async () => returningRows,
      };
      return chain;
    },
  },
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
let sweptTenants: string[] = [TENANT_ID];
let sweepResult: {
  visited: number;
  skipped: { tenantId: string; reason: string }[];
  failed: { tenantId: string; error: string }[];
} = { visited: 1, skipped: [], failed: [] };

/**
 * A contract ending exactly `days` out, built with the same local-midnight plus
 * ISO-date arithmetic the route uses for its reminder windows, so the fixture is
 * inside the 30/14/7/3-day window the route checks.
 */
function endDateIn(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0] as string;
}

function contractRow(overrides: Record<string, unknown>) {
  return {
    id: 'c-1',
    title: 'Enterprise support',
    contractNumber: 'CT-001',
    endDate: endDateIn(30),
    totalValue: '12000.00',
    tenantId: TENANT_ID,
    contactId: 'contact-1',
    ...overrides,
  };
}

/**
 * Column names a Drizzle condition actually references. Walks `queryChunks` only
 * and stops at column nodes, so it proves the filter is on a real column rather
 * than matching a coincidental string in the SQL text.
 */
function referencedColumns(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) referencedColumns(n, out, depth + 1);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec['columnType'] === 'string' && typeof rec['name'] === 'string') {
    out.push(rec['name']);
    return out;
  }
  if (Array.isArray(rec['queryChunks'])) referencedColumns(rec['queryChunks'], out, depth + 1);
  if (rec['encoder']) referencedColumns(rec['encoder'], out, depth + 1);
  return out;
}

function callsOnTable(call: SelectCall | undefined, table: unknown): boolean {
  return call !== undefined && call.table === table;
}

async function runCron() {
  const { POST } = await import('@/app/api/cron/contract-renewal-check/route');
  const res = await POST({ headers: new Headers() } as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('contract renewal notification matrix', () => {
  it('EVENT_KEYS includes contract.expiring', async () => {
    const mod = await import('@/app/api/tenant/notifications/matrix/route');
    expect(mod.GET).toBeDefined();
  });

  it('contract events default to email notifications enabled', async () => {
    const mod = await import('@/app/api/tenant/notifications/matrix/route');
    expect(mod.GET).toBeDefined();
    expect(mod.PATCH).toBeDefined();
  });
});

describe('contract renewal cron endpoint', () => {
  it('module loads with POST handler', async () => {
    const mod = await import('@/app/api/cron/contract-renewal-check/route');
    expect(mod.POST).toBeDefined();
  });

  it('POST handler is a function', async () => {
    const mod = await import('@/app/api/cron/contract-renewal-check/route');
    expect(typeof mod.POST).toBe('function');
  });
});

describe('contract renewal cron scheduler', () => {
  it('cron-scheduler.ts includes contract-renewal-check job', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('scripts/cron-scheduler.ts', 'utf-8');
    expect(content).toContain('contract-renewal-check');
    expect(content).toContain('0 7 * * *');
  });

  it('deploy/cron/crontab includes contract-renewal-check', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('deploy/cron/crontab', 'utf-8');
    expect(content).toContain('contract-renewal-check');
    expect(content).toContain('0 7 * * *');
  });
});

describe('POST /api/cron/contract-renewal-check', () => {
  beforeEach(() => {
    selectCalls.length = 0;
    updates.length = 0;
    inserts.length = 0;
    rowsByTable.clear();
    returningRows = [];
    sweptTenants = [TENANT_ID];
    sweepResult = { visited: 1, skipped: [], failed: [] };
    mockAcquireLock.mockReset();
    mockAcquireLock.mockResolvedValue({ acquired: true });
    mockSweepTenants.mockClear();
    mockCreateNotification.mockClear();
    mockSendEmail.mockClear();
  });

  it('reminds and expires inside a per-tenant sweep and reports the counters', async () => {
    rowsByTable.set(contracts, [contractRow({})]);
    rowsByTable.set(activities, []);
    rowsByTable.set(users, [{ userId: 'user-1', email: 'ada@example.com', fullName: 'Ada' }]);
    returningRows = [{ id: 'c-9' }, { id: 'c-10' }];

    const res = await runCron();

    expect(mockSweepTenants).toHaveBeenCalledWith('cron/contract-renewal-check', expect.any(Function));

    // contracts and activities enforce plain tenant_isolation, so every read and
    // write must also carry an explicit tenant filter — a tenant_id IS NULL row
    // would otherwise be picked up under whichever tenant happens to run.
    expect(referencedColumns(selectCalls.find((c) => callsOnTable(c, contracts))?.where)).toContain('tenant_id');
    expect(referencedColumns(selectCalls.find((c) => callsOnTable(c, activities))?.where)).toContain('tenant_id');
    expect(updates).toHaveLength(1);
    expect((updates[0]!.payload as Record<string, unknown>).status).toBe('expired');
    expect(referencedColumns(updates[0]!.where)).toContain('tenant_id');

    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 0,
      remindersSent: 1,
      expired: 2,
    });

    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      tenantId: TENANT_ID,
      type: 'contract_renewal',
      title: 'Contract "Enterprise support" expires in 30 days',
    }));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toMatchObject({
      tenantId: TENANT_ID,
      entityType: 'contract',
      entityId: 'c-1',
      eventType: 'contract_renewal_reminder',
    });
  });

  it('does not re-remind a (contract, days) combo already logged', async () => {
    rowsByTable.set(contracts, [contractRow({})]);
    rowsByTable.set(activities, [{ entityId: 'c-1', metadata: { reminder_days: 30 } }]);
    rowsByTable.set(users, [{ userId: 'user-1', email: 'ada@example.com', fullName: 'Ada' }]);

    const res = await runCron();

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 0,
      remindersSent: 0,
      expired: 0,
    });
  });

  it('is not ok when a tenant failed, and still reports what was processed', async () => {
    rowsByTable.set(contracts, [contractRow({})]);
    rowsByTable.set(activities, []);
    rowsByTable.set(users, []);
    sweepResult = { visited: 1, skipped: [], failed: [{ tenantId: OTHER_TENANT_ID, error: 'boom' }] };

    const res = await runCron();

    expect(res.status).toBe(200);
    // A contract with no member to notify is still counted as reminded, but
    // nothing is sent — the sweep reports the failure of the other tenant.
    expect(res.body).toEqual({
      ok: false,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 1,
      remindersSent: 1,
      expired: 0,
    });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('reports tenants the sweep skipped instead of pretending the run was clean', async () => {
    sweptTenants = [];
    sweepResult = { visited: 0, skipped: [{ tenantId: OTHER_TENANT_ID, reason: 'no-acting-user' }], failed: [] };

    const res = await runCron();

    expect(selectCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 0,
      tenants_skipped: 1,
      tenants_failed: 0,
      remindersSent: 0,
      expired: 0,
    });
  });

  it('does not sweep when the dedup lock is held', async () => {
    mockAcquireLock.mockResolvedValue({ acquired: false });

    const res = await runCron();

    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true, skipped: true, reason: 'lock-held' });
  });
});

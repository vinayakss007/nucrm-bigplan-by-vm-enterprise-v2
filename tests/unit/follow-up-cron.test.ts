import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';

// Sweep state the stubbed sweepTenants reads at call time (i.e. during a test,
// after this module has finished initialising).
let sweptTenants: string[] = [TENANT_ID];
let sweepResult: CronTenantSweep = { visited: 1, skipped: [], failed: [] };

const mockAcquireLock = vi.fn(async () => ({ acquired: true }));
vi.mock('@/lib/cache', () => ({
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
}));

vi.mock('@/lib/crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crypto')>()),
  verifySecret: () => true,
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => {}),
}));

vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn(() => NextResponse.json({ error: 'Internal error' }, { status: 500 })),
}));

const mockCreateNotification = vi.fn(async () => true);
vi.mock('@/lib/notifications', () => ({
  createNotification: (opts: unknown) => mockCreateNotification(opts),
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

// Records the update chain the route builds, so the payload and the tenant
// filter can be asserted without a connection.
type UpdateChain = {
  set: (payload: unknown) => UpdateChain;
  where: (where: unknown) => UpdateChain;
  returning: () => Promise<unknown[]>;
};
const updates: Array<{ table: unknown; payload: unknown; where: unknown }> = [];
let returningRows: unknown[] = [];
vi.mock('@/drizzle/db', () => ({
  db: {
    update: (table: unknown) => {
      const rec = { table, payload: undefined as unknown, where: undefined as unknown };
      updates.push(rec);
      const chain: UpdateChain = {
        set: (payload: unknown) => {
          rec.payload = payload;
          return chain;
        },
        where: (where: unknown) => {
          rec.where = where;
          return chain;
        },
        returning: async () => returningRows,
      };
      return chain;
    },
  },
}));

function missedRow(overrides: Record<string, unknown>) {
  return {
    id: 'fu-1',
    missedDays: 2,
    assignedTo: 'user-1',
    tenantId: TENANT_ID,
    title: 'Call the client',
    entityType: 'deal',
    entityId: 'deal-1',
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

async function runCron() {
  const { POST } = await import('@/app/api/cron/detect-missed-followups/route');
  const res = await POST({ headers: new Headers() } as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('Cron jobs registration', () => {
  it('detect-missed-followups and ai-auto-followup are registered in cron-scheduler.ts', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('scripts/cron-scheduler.ts', 'utf-8');
    expect(content).toContain('detect-missed-followups');
    expect(content).toContain('ai-auto-followup');
    expect(content).toContain('*/30 * * * *');
    expect(content).toContain('30 * 60_000');
    expect(content).toContain('60 * 60_000');
  });

  it('detect-missed-followups and ai-auto-followup are registered in crontab', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('deploy/cron/crontab', 'utf-8');
    expect(content).toContain('detect-missed-followups');
    expect(content).toContain('ai-auto-followup');
    expect(content).toContain('*/30 * * * *');
    expect(content).toContain('0 * * * *');
  });

  it('follow-ups list page includes pagination and new follow-up button', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('app/tenant/follow-ups/page.tsx', 'utf-8');
    expect(content).toContain('New Follow-up');
    expect(content).toContain('Previous');
    expect(content).toContain('Next');
    expect(content).toContain('offset');
    expect(content).toContain('totalPages');
    expect(content).toContain('assigneeName');
  });

  it('missed follow-ups page no longer fetches or passes unused teamMembers', async () => {
    const fs = await import('fs');
    const pageContent = fs.readFileSync('app/tenant/follow-ups/missed/page.tsx', 'utf-8');
    const clientContent = fs.readFileSync('app/tenant/follow-ups/missed/missed-followups-client.tsx', 'utf-8');
    expect(pageContent).not.toContain('teamMembers');
    expect(clientContent).not.toContain('teamMembers');
    expect(clientContent).not.toContain('_teamMembers');
  });
});

describe('POST /api/cron/detect-missed-followups', () => {
  beforeEach(() => {
    updates.length = 0;
    returningRows = [];
    sweptTenants = [TENANT_ID];
    sweepResult = { visited: 1, skipped: [], failed: [] };
    mockAcquireLock.mockReset();
    mockAcquireLock.mockResolvedValue({ acquired: true });
    mockSweepTenants.mockClear();
    mockCreateNotification.mockClear();
  });

  it('marks overdue follow-ups inside a per-tenant sweep and reports the counters', async () => {
    returningRows = [missedRow({ id: 'fu-1' }), missedRow({ id: 'fu-2' }), missedRow({ id: 'fu-3', assignedTo: null })];

    const res = await runCron();

    expect(mockSweepTenants).toHaveBeenCalledWith('cron/detect-missed-followups', expect.any(Function));
    expect(updates).toHaveLength(1);
    expect((updates[0]!.payload as Record<string, unknown>).status).toBe('missed');

    // follow_ups enforces plain tenant_isolation, so the UPDATE must carry an
    // explicit tenant filter — otherwise a tenant_id IS NULL row could be
    // picked up under whichever tenant happens to run.
    expect(referencedColumns(updates[0]!.where)).toContain('tenant_id');

    // Assignments without a user are counted as missed but not notified.
    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 0,
      total_missed: 3,
    });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      tenantId: TENANT_ID,
      type: 'task_overdue',
      title: 'You have 2 missed follow-ups',
    }));
  });

  it('is not ok when a tenant failed, and still reports what was processed', async () => {
    returningRows = [missedRow({})];
    sweepResult = { visited: 1, skipped: [], failed: [{ tenantId: OTHER_TENANT_ID, error: 'boom' }] };

    const res = await runCron();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 1,
      total_missed: 1,
    });
  });

  it('reports tenants the sweep skipped instead of pretending the run was clean', async () => {
    sweptTenants = [];
    sweepResult = { visited: 0, skipped: [{ tenantId: OTHER_TENANT_ID, reason: 'no-acting-user' }], failed: [] };

    const res = await runCron();

    expect(updates).toHaveLength(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 0,
      tenants_skipped: 1,
      tenants_failed: 0,
      total_missed: 0,
    });
  });

  it('does not sweep when the dedup lock is held', async () => {
    mockAcquireLock.mockResolvedValue({ acquired: false });

    const res = await runCron();

    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true, skipped: true, reason: 'lock-held' });
  });
});

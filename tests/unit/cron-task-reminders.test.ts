import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';

// Sweep state read at call time by the stubbed sweepTenants.
let sweptTenants: string[] = [TENANT_A];
let sweepResult: CronTenantSweep = { visited: 1, skipped: [], failed: [] };
let currentSweepTenant: string | null = null;

const mockAcquireLock = vi.fn(async () => ({ acquired: true }));
vi.mock('@/lib/cache', () => ({
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
}));

vi.mock('@/lib/crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crypto')>()),
  verifySecret: () => true,
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn(() => NextResponse.json({ error: 'Internal error' }, { status: 500 })),
}));

const mockCreateNotification = vi.fn(async () => true);
vi.mock('@/lib/notifications', () => ({
  createNotification: (opts: unknown) => mockCreateNotification(opts),
}));

const mockSendEmail = vi.fn(async () => true);
vi.mock('@/lib/email/service', () => ({
  sendEmail: (opts: unknown) => mockSendEmail(opts),
}));

// The real sweep is covered by cron-tenant-scope.test.ts; stub it so the body
// runs once per fixed tenant and the route's own accumulation/reporting is
// what is under test. The context set for the body mirrors the real helper.
const mockSweepTenants = vi.fn(async (_context: string, body: (tenantId: string) => Promise<void>) => {
  for (const tenantId of sweptTenants) {
    currentSweepTenant = tenantId;
    await body(tenantId);
  }
  currentSweepTenant = null;
  return sweepResult;
});
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (tenantId: string) => Promise<void>) => mockSweepTenants(context, body),
}));

// Records every condition node the route attaches to a SELECT (from / join /
// where) so tenant filters can be asserted without a live connection.
type SelectCall = { nodes: Array<{ kind: string; cond: unknown }>; rows: unknown[]; fromTable: string };
const selectCalls: SelectCall[] = [];
let dueTodayRows: unknown[] = [];
let overdueRows: unknown[] = [];
// Rows the #2224 dedupe marker lookup returns: notifications already created
// TODAY for these (user, type, task) triples. Empty = first run of the day.
let remindedRows: Array<{ userId: string; type: string; entityId: string }> = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const call: SelectCall = { nodes: [], rows: [], fromTable: '' };
      selectCalls.push(call);
      let sawLeftJoin = false;
      const chain: Record<string, unknown> = {};
      chain.from = (source: unknown) => {
        const table = source as Record<symbol, unknown> | undefined;
        call.fromTable = String(table?.[Symbol.for('drizzle:Name')] ?? '');
        return chain;
      };
      // Joins take (table, on-condition): capture the on-condition, not the table.
      chain.innerJoin = (_table: unknown, cond?: unknown) => {
        call.nodes.push({ kind: 'innerJoin', cond });
        return chain;
      };
      chain.leftJoin = (_table: unknown, cond?: unknown) => {
        call.nodes.push({ kind: 'leftJoin', cond });
        sawLeftJoin = true;
        return chain;
      };
      chain.where = (cond: unknown) => {
        call.nodes.push({ kind: 'where', cond });
        if (call.fromTable === 'notifications') {
          // The dedupe marker lookup — rows are already in their final shape.
          call.rows = remindedRows;
          return Promise.resolve(call.rows);
        }
        // dueToday query leftJoins contacts; the overdue query does not.
        const base = sawLeftJoin ? dueTodayRows : overdueRows;
        // Rows come back scoped to whichever tenant the sweep is running for.
        call.rows = base.map((r) => ({ ...(r as Record<string, unknown>), tenantId: currentSweepTenant }));
        return Promise.resolve(call.rows);
      };
      return chain;
    },
  },
}));

function makeRow(overrides: Record<string, unknown>) {
  return {
    id: 'task-1',
    title: 'Call client',
    tenantId: currentSweepTenant,
    userId: 'user-1',
    email: 'rep@example.com',
    fullName: 'Rep One',
    dueDate: new Date(),
    ...overrides,
  };
}

/** Rendered bound values + column names of the #2224 dedupe-marker SELECT. */
function markerLookupPredicates(): string {
  return selectCalls
    .filter((call) => call.fromTable === 'notifications')
    .map((call) => renderValues(call.nodes.find((n) => n.kind === 'where')?.cond))
    .join(' | ');
}

/** Column names a Drizzle condition actually references. */
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

/** The tenant-scoped predicates are the ones attached to `where` and `leftJoin`. */
function conditionsForTenantFiltering(call: SelectCall): unknown[] {
  return call.nodes.filter((n) => n.kind === 'where' || n.kind === 'leftJoin').map((n) => n.cond);
}

async function runCron() {
  const { POST } = await import('@/app/api/cron/task-reminders/route');
  const res = await POST({ headers: new Headers({ 'x-cron-secret': 's' }) } as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('POST /api/cron/task-reminders', () => {
  beforeEach(() => {
    selectCalls.length = 0;
    sweptTenants = [TENANT_A];
    currentSweepTenant = null;
    sweepResult = { visited: 1, skipped: [], failed: [] };
    dueTodayRows = [makeRow({ id: 'due-1', contactFirst: 'Jane', contactLast: 'Doe' })];
    overdueRows = [makeRow({ id: 'over-1', dueDate: new Date(Date.now() - 1.5 * 86400000) })];
    remindedRows = [];
    mockAcquireLock.mockReset();
    mockAcquireLock.mockResolvedValue({ acquired: true });
    mockSweepTenants.mockClear();
    mockCreateNotification.mockClear();
    // Deliberate failures in one test must not leak into the next.
    mockCreateNotification.mockResolvedValue(true);
    mockSendEmail.mockClear();
  });

  it('runs the due/overdue work inside a per-tenant sweep and reports the counters', async () => {
    const res = await runCron();

    expect(mockSweepTenants).toHaveBeenCalledWith('cron/task-reminders', expect.any(Function));
    // Three SELECTs per swept tenant: due-today, overdue, and the #2224
    // dedupe-marker lookup over notifications.
    expect(selectCalls).toHaveLength(3);

    // The response carries the sweep counters alongside the original fields.
    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 0,
      due_today: 1,
      overdue: 1,
      notified: 2,
      notify_failed: 0,
      already_reminded: 0,
    });
  });

  it('every tenant-table query carries an explicit tenant_id filter', async () => {
    sweptTenants = [TENANT_A, TENANT_B];
    sweepResult = { visited: 2, skipped: [], failed: [] };
    await runCron();

    // Due-today + overdue + dedupe-marker SELECT per tenant.
    expect(selectCalls).toHaveLength(6);
    for (const call of selectCalls) {
      const conds = conditionsForTenantFiltering(call);
      expect(conds.length).toBeGreaterThan(0);
      for (const cond of conds) {
        expect(referencedColumns(cond)).toContain('tenant_id');
      }
    }
  });

  it('binds the swept tenant id into each query (not a global or fixed scope)', async () => {
    sweptTenants = [TENANT_A, TENANT_B];
    sweepResult = { visited: 2, skipped: [], failed: [] };
    // Return no rows so only the emitted predicates matter, not the side effects.
    dueTodayRows = [];
    overdueRows = [];

    await runCron();

    const rendered = selectCalls
      .map((call) => renderValues(call.nodes.find((n) => n.kind === 'where')?.cond))
      .join('|');
    // Every query filters on the tenant_id column and binds a real tenant id,
    // and both tenants of the sweep appear across the set of queries.
    expect(rendered).toMatch(/tenant_id/);
    expect(rendered).toContain(TENANT_A);
    expect(rendered).toContain(TENANT_B);
  });

  it('notifies due-today assignees and overdue reps, emailing only the 1-day-overdue case', async () => {
    // due-1 has no contact; over-1 is 1.5 days overdue -> email fires.
    dueTodayRows = [makeRow({ id: 'due-1' })];
    overdueRows = [makeRow({ id: 'over-1', dueDate: new Date(Date.now() - 1.5 * 86400000) })];
    await runCron();

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', tenantId: TENANT_A, type: 'task_due',
    }));
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', tenantId: TENANT_A, type: 'task_overdue',
    }));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'rep@example.com' }));
  });

  // #2224: the cron fires hourly; without a per-day marker every due/overdue
  // task produced ~24 notifications and ~24 emails per day. The marker is the
  // day's own notification row, checked once per tenant per run.
  it('#2224 suppresses both notification and email when today\'s marker exists', async () => {
    remindedRows = [
      { userId: 'user-1', type: 'task_due', entityId: 'due-1' },
      { userId: 'user-1', type: 'task_overdue', entityId: 'over-1' },
    ];
    const res = await runCron();

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      ok: true, notified: 0, notify_failed: 0, already_reminded: 2,
    });
  });

  it('#2224 still emails when the overdue notification lands for the first time today', async () => {
    // Only the task_due marker exists — the task_overdue reminder is fresh, so
    // the notification is created and the 1-day-overdue email fires once.
    remindedRows = [{ userId: 'user-1', type: 'task_due', entityId: 'due-1' }];
    const res = await runCron();

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_overdue' }));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ ok: true, notified: 1, already_reminded: 1 });
  });

  it('#2224 sends no email when the overdue notification insert fails (no marker written)', async () => {
    mockCreateNotification.mockResolvedValue(false);
    overdueRows = [makeRow({ id: 'over-1', dueDate: new Date(Date.now() - 1.5 * 86400000) })];
    const res = await runCron();

    // The failed insert writes no marker, so the next hourly run retries —
    // but this run must not email, or a persisting failure would re-email 24×.
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: false, notified: 0, notify_failed: 2, already_reminded: 0 });
  });

  it('#2224 scopes the marker to the current UTC day — the next day reminds again', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
      dueTodayRows = [makeRow({ id: 'due-1' })];
      overdueRows = [];

      // Run 1 (first of the day): no marker -> notification created, and the
      // marker lookup binds today's UTC date.
      let res = await runCron();
      expect(res.body).toMatchObject({ ok: true, notified: 1, already_reminded: 0 });
      expect(markerLookupPredicates()).toContain('2026-06-15');

      // Run 2, same day: the run-1 notification IS the marker -> nothing fires.
      selectCalls.length = 0;
      remindedRows = [{ userId: 'user-1', type: 'task_due', entityId: 'due-1' }];
      res = await runCron();
      expect(res.body).toMatchObject({ ok: true, notified: 0, already_reminded: 1 });

      // Next day: yesterday's marker falls outside the date predicate (the real
      // DB returns nothing for the new day) and the bound date advanced, so the
      // task is reminded exactly once again.
      vi.setSystemTime(new Date('2026-06-16T10:00:00.000Z'));
      selectCalls.length = 0;
      remindedRows = [];
      res = await runCron();
      expect(res.body).toMatchObject({ ok: true, notified: 1, already_reminded: 0 });
      expect(markerLookupPredicates()).toContain('2026-06-16');

      // One notification per day per task across three hourly-style runs.
      expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not ok when a tenant failed, while still reporting what ran', async () => {
    sweepResult = { visited: 1, skipped: [], failed: [{ tenantId: OTHER_TENANT, error: 'boom' }] };
    const res = await runCron();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, tenants_checked: 1, tenants_failed: 1 });
  });

  it('reports tenants the sweep skipped instead of pretending a clean run', async () => {
    sweptTenants = [];
    sweepResult = { visited: 0, skipped: [{ tenantId: OTHER_TENANT, reason: 'no-acting-user' }], failed: [] };
    const res = await runCron();
    expect(selectCalls).toHaveLength(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 0,
      tenants_skipped: 1,
      tenants_failed: 0,
      due_today: 0,
      overdue: 0,
      notified: 0,
      notify_failed: 0,
      already_reminded: 0,
    });
  });

  it('counts an undeliverable notification as failed, never as notified', async () => {
    // createNotification() returns false instead of throwing once its retry is
    // exhausted. The chk_notifications_type drift (#58) hit exactly this: the
    // job said `notified:4` while zero rows were inserted.
    mockCreateNotification.mockResolvedValue(false);
    const res = await runCron();

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(res.body).toMatchObject({ ok: false, notified: 0, notify_failed: 2 });
  });

  it('does not sweep when the dedup lock is held', async () => {
    mockAcquireLock.mockResolvedValue({ acquired: false });
    const res = await runCron();
    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true, skipped: true, reason: 'lock-held' });
  });
});

/** Walk a predicate and collect the literal param values bound into it. */
function renderValues(node: unknown, out: string[] = [], depth = 0): string {
  if (depth > 12) return out.join(' ');
  if (typeof node === 'string') { out.push(node); return out.join(' '); }
  if (node === null || typeof node !== 'object') return out.join(' ');
  if (Array.isArray(node)) { for (const n of node) renderValues(n, out, depth + 1); return out.join(' '); }
  const rec = node as Record<string, unknown>;
  if (typeof rec['columnType'] === 'string' && typeof rec['name'] === 'string') { out.push(String(rec['name'])); return out.join(' '); }
  if ('value' in rec && typeof rec['value'] !== 'object') out.push(String(rec['value']));
  if (Array.isArray(rec['queryChunks'])) renderValues(rec['queryChunks'], out, depth + 1);
  if (rec['encoder']) renderValues(rec['encoder'], out, depth + 1);
  return out.join(' ');
}

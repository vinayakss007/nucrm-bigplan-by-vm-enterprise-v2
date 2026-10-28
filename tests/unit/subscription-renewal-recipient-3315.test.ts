/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Issue #3315 ask 2 — subscription-renewal-check's recipient read.
 *
 * The route looks up the tenant's active members per subscription and then
 * loops over the result. When that read comes back empty it sends nothing,
 * still writes the `subscription_renewal_reminder` activity row, still bumps
 * `remindersSent`, and still returns `{ok: true}`. The scheduler therefore sees
 * a clean daily run while a tenant's renewals went completely unannounced, and
 * the dedup marker it wrote suppresses every retry.
 *
 * This spec pins the opposite: an empty recipient read is reported as a failure
 * of the run, no dedup marker is written, and nothing is counted as sent.
 *
 * The sweep itself is covered by tests/unit/cron-tenant-scope.test.ts; it is
 * stubbed here so the route's own accumulation and reporting is what is tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { serviceSubscriptions, activities, users } from '@/drizzle/schema';

vi.mock('@/lib/auth/cron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/cron')>()),
  verifyCronSecret: vi.fn(async () => true),
}));

const mockAcquireLock = vi.fn(async () => ({ acquired: true }));
vi.mock('@/lib/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cache')>()),
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
}));

const mockLogError = vi.fn(async () => {});
vi.mock('@/lib/errors-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/errors-server')>()),
  logError: (opts: unknown) => mockLogError(opts),
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

const mockSendEmail = vi.fn(async () => ({ success: true, provider: 'resend', id: 'msg-1' }));
vi.mock('@/lib/email/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/service')>()),
  sendEmail: (opts: unknown) => mockSendEmail(opts),
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const sweptTenants: string[] = [TENANT_ID];
let sweepResult = { visited: 1, skipped: [] as { tenantId: string; reason: string }[], failed: [] as { tenantId: string; error: string }[] };

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: async (_context: string, body: (tenantId: string) => Promise<void>) => {
    for (const tenantId of sweptTenants) await body(tenantId);
    return sweepResult;
  },
}));

type SelectCall = { table: unknown; where: unknown };
const selectCalls: SelectCall[] = [];
const inserts: Array<{ table: unknown; values: unknown }> = [];
const updates: Array<{ table: unknown; payload: unknown }> = [];
const rowsByTable = new Map<unknown, unknown[]>();
/**
 * The route queries `service_subscriptions` once per reminder window (30/14/7/3
 * days). In the database only the window whose date matches a subscription
 * returns it, so the stub answers the first read and goes empty for the rest —
 * otherwise every fixture row would be counted as "ending" four times.
 */
let windowsToAnswer = 1;
let returningRows: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const call: SelectCall = { table: undefined, where: undefined };
      selectCalls.push(call);
      const chain: Record<string, unknown> = {
        from: (table: unknown) => { call.table = table; return chain; },
        where: (where: unknown) => { call.where = where; return chain; },
        innerJoin: () => chain,
        limit: () => chain,
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
          const rows = call.table === serviceSubscriptions
            ? (windowsToAnswer-- > 0 ? (rowsByTable.get(serviceSubscriptions) ?? []) : [])
            : (rowsByTable.get(call.table) ?? []);
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => { inserts.push({ table, values }); return Promise.resolve(); },
    }),
    update: (table: unknown) => {
      const call: { table: unknown; payload: unknown } = { table, payload: undefined };
      updates.push(call);
      const chain: Record<string, unknown> = {
        set: (payload: unknown) => { call.payload = payload; return chain; },
        where: () => chain,
        returning: async () => returningRows,
      };
      return chain;
    },
  },
}));

function endDateIn(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0] as string;
}

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    name: 'Support plan',
    planName: 'Pro',
    status: 'active',
    currentPeriodEnd: endDateIn(14),
    amount: '500.00',
    autoRenew: true,
    tenantId: TENANT_ID,
    contactId: 'contact-1',
    ...overrides,
  };
}

const member = { userId: 'user-1', email: 'ada@example.com', fullName: 'Ada' };

async function runCron() {
  const { POST } = await import('@/app/api/cron/subscription-renewal-check/route');
  const res = await POST({ headers: new Headers() } as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('POST /api/cron/subscription-renewal-check recipient read (#3315)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCalls.length = 0;
    inserts.length = 0;
    updates.length = 0;
    rowsByTable.clear();
    returningRows = [];
    windowsToAnswer = 1;
    sweepResult = { visited: 1, skipped: [], failed: [] };
    mockAcquireLock.mockResolvedValue({ acquired: true });
  });

  it('sends and reports a clean run when the tenant has a member to notify', async () => {
    rowsByTable.set(serviceSubscriptions, [subRow()]);
    rowsByTable.set(activities, []);
    rowsByTable.set(users, [member]);

    const res = await runCron();

    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 0,
      remindersSent: 1,
      reminders_without_recipient: 0,
      pastDue: 0,
    });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
  });

  it('reports an empty recipient read as a failed run and writes no dedup marker', async () => {
    rowsByTable.set(serviceSubscriptions, [subRow(), subRow({ id: 'sub-2', name: 'Hosting plan' })]);
    rowsByTable.set(activities, []);
    rowsByTable.set(users, []);

    const res = await runCron();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      tenants_checked: 1,
      tenants_skipped: 0,
      tenants_failed: 0,
      remindersSent: 0,
      reminders_without_recipient: 2,
      pastDue: 0,
    });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.stringContaining('recipients') }),
    );
  });

  it('still retries a subscription whose recipient read comes back empty', async () => {
    // Two runs of the same day: the first finds nobody, the second finds the
    // member the tenant gained in between. If the empty run had written the
    // activity row, the second run would skip this subscription forever.
    rowsByTable.set(serviceSubscriptions, [subRow()]);
    rowsByTable.set(activities, []);
    rowsByTable.set(users, []);
    await runCron();
    expect(inserts).toHaveLength(0);

    // The second run reads its dedup markers back from what the first run wrote,
    // so a marker emitted by the empty run would suppress the retry here.
    rowsByTable.set(activities, inserts.map((i) => ({ entityId: (i.values as { entityId?: string }).entityId })));
    rowsByTable.set(users, [member]);
    windowsToAnswer = 1;
    const res = await runCron();
    expect(res.body).toMatchObject({ ok: true, remindersSent: 1 });
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });

  it('does not count a subscription as sent when the provider rejected the email (#3045)', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: '403 forbidden' });
    rowsByTable.set(serviceSubscriptions, [subRow()]);
    rowsByTable.set(activities, []);
    rowsByTable.set(users, [member]);

    const res = await runCron();

    expect(res.body).toMatchObject({ remindersSent: 0, reminders_without_recipient: 0 });
    expect(inserts).toHaveLength(0);
  });
});

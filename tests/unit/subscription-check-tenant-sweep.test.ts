/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the subscription-check cron's per-tenant sweep.
 *
 * `subscriptions` and `billing_events` carry only the plain tenant_isolation
 * policy (no super-admin branch), so an unscoped run selected zero stale
 * subscriptions and still reported ok:true — see lib/cron/tenant-scope.ts.
 *
 * '@/lib/cron/tenant-scope' is mocked so sweepTenants invokes the body once per
 * fixed tenant, and drizzle-orm's eq()/sql`` are instrumented so every scan and
 * every write can be shown to carry an explicit tenant filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type SqlFragment = { text: string; values: unknown[] };

const mockLock = { acquired: true, value: 'lock-1' };

const mockState = {
  eqCalls: [] as Array<{ column: unknown; value: unknown }>,
  /** Stale subscriptions the DB would return, keyed by tenant. */
  staleByTenant: new Map<string, unknown[]>(),
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ set: Record<string, unknown> }>,
  tenantUpdates: [] as Array<{ set: Record<string, unknown> }>,
  /** The tenant whose context the (mocked) sweep is currently standing in. */
  activeTenant: null as string | null,
};

async function defaultSweep(
  _context: string,
  body: (tenantId: string) => Promise<void>,
): Promise<CronTenantSweep> {
  const tenants = [TENANT_A, TENANT_B];
  for (const tenantId of tenants) {
    mockState.activeTenant = tenantId;
    await body(tenantId);
  }
  mockState.activeTenant = null;
  return { visited: tenants.length, skipped: [], failed: [] };
}

const mockSweepTenants = vi.fn(defaultSweep);

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: mockSweepTenants,
}));

vi.mock('drizzle-orm', () => {
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment => {
    const parts: string[] = [];
    const flat: unknown[] = [];
    for (let i = 0; i < strings.length; i++) {
      parts.push(strings[i] ?? '');
      if (i < values.length) {
        const v = values[i];
        if (v && typeof v === 'object' && 'text' in v && 'values' in v) {
          const frag = v as SqlFragment;
          parts.push(frag.text);
          flat.push(...frag.values);
        } else {
          parts.push('?');
          flat.push(v);
        }
      }
    }
    return { text: parts.join(''), values: flat };
  };
  return {
    eq: (column: unknown, value: unknown) => {
      mockState.eqCalls.push({ column, value });
      return { __eq: { column, value } };
    },
    and: (...args: unknown[]) => args.filter(Boolean),
    or: (...args: unknown[]) => args.filter(Boolean),
    lt: (column: unknown, value: unknown) => ({ __lt: { column, value } }),
    ne: (column: unknown, value: unknown) => ({ __ne: { column, value } }),
    sql: sqlTag,
  };
});

vi.mock('@/drizzle/schema', () => ({
  tenants: { __table: 'tenants', id: 'tenants.id', planId: 'tenants.plan_id', status: 'tenants.status' },
  subscriptions: {
    __table: 'subscriptions',
    id: 'subscriptions.id',
    tenantId: 'subscriptions.tenant_id',
    status: 'subscriptions.status',
    planId: 'subscriptions.plan_id',
    cancelAtPeriodEnd: 'subscriptions.cancel_at_period_end',
    currentPeriodEnd: 'subscriptions.current_period_end',
    stripeSubscriptionId: 'subscriptions.stripe_subscription_id',
  },
  billingEvents: { __table: 'billing_events', tenantId: 'billing_events.tenant_id' },
}));

const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const entry = { set: values };
          if ((table as { __table?: string }).__table === 'tenants') mockState.tenantUpdates.push(entry);
          else mockState.updates.push(entry);
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: unknown) => {
        mockState.inserts.push({ table: (table as { __table?: string }).__table ?? 'unknown', values: vals });
        return Promise.resolve();
      },
    }),
  };
  return fn(tx);
});

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: mockTransaction,
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          // The scan is scoped by the RLS context the sweep set, so the mock
          // returns only the active tenant's rows.
          where: () => Promise.resolve(
            mockState.staleByTenant.get(mockState.activeTenant ?? '') ?? []
          ),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/crypto', () => ({ verifySecret: vi.fn(() => true) }));
vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue(mockLock),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

function staleRow(tenantId: string, subscriptionId: string) {
  return {
    subscriptionId,
    tenantId,
    stripeStatus: 'canceled',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/subscription-check', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('subscription-check cron — per-tenant sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.eqCalls.length = 0;
    mockState.inserts.length = 0;
    mockState.updates.length = 0;
    mockState.tenantUpdates.length = 0;
    mockState.activeTenant = null;
    mockState.staleByTenant = new Map([
      [TENANT_A, [staleRow(TENANT_A, 'sub-a')]],
      [TENANT_B, [staleRow(TENANT_B, 'sub-b')]],
    ]);
    mockSweepTenants.mockImplementation(defaultSweep);
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const res = await POST(
      new Request('http://localhost/api/cron/subscription-check', { method: 'POST' }) as unknown as NextRequest,
    );

    expect(res.status).toBe(401);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('skips the sweep when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.skipped).toBe(true);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('runs the scan once per tenant and reports the sweep counters', async () => {
    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/subscription-check', expect.any(Function));
    expect(body).toMatchObject({
      ok: true,
      scanned: 2,
      downgraded: 2,
      failed: 0,
      tenants_checked: 2,
      tenants_skipped: 0,
      tenants_failed: 0,
    });
  });

  it('binds an explicit tenant filter to the scan and to the subscription write', async () => {
    const { POST } = await import('@/app/api/cron/subscription-check/route');
    await POST(makeRequest());

    const tenantScoped = mockState.eqCalls.filter(
      (c) => c.column === 'subscriptions.tenant_id' && (c.value === TENANT_A || c.value === TENANT_B),
    );
    // One filter for the scan, one for the row cleanup, per tenant.
    expect(tenantScoped).toHaveLength(4);
    expect(tenantScoped.map((c) => c.value)).toEqual([TENANT_A, TENANT_A, TENANT_B, TENANT_B]);

    // The join target is pinned to the same tenant, never left to RLS alone.
    expect(mockState.eqCalls.some((c) => c.column === 'tenants.id')).toBe(true);
  });

  it('downgrades the tenant, clears the subscription and writes the audit event', async () => {
    const { POST } = await import('@/app/api/cron/subscription-check/route');
    await POST(makeRequest());

    expect(mockState.tenantUpdates).toHaveLength(2);
    expect(mockState.tenantUpdates[0]!.set).toMatchObject({ planId: 'free', status: 'cancelled' });

    expect(mockState.updates).toHaveLength(2);
    expect(mockState.updates[0]!.set).toMatchObject({ planId: 'free', stripeSubscriptionId: null });

    expect(mockState.inserts).toHaveLength(2);
    expect(mockState.inserts[0]!.values).toMatchObject({
      tenantId: TENANT_A,
      eventType: 'subscription_downgraded',
    });
  });

  it('reports nothing and writes nothing when no tenant has a stale subscription', async () => {
    mockState.staleByTenant = new Map([[TENANT_A, []], [TENANT_B, []]]);

    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const body = await (await POST(makeRequest())).json();

    expect(body).toMatchObject({ ok: true, scanned: 0, downgraded: 0, tenants_checked: 2 });
    expect(mockState.inserts).toHaveLength(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('flips ok when a tenant aborts the sweep', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(false);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(1);
    expect(body.tenants_failed).toBe(1);
  });

  it('counts a failed downgrade without aborting the tenant sweep', async () => {
    mockTransaction.mockImplementationOnce(async () => {
      throw new Error('stripe row locked');
    });

    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.downgraded).toBe(1);
    expect(body.failed).toBe(1);
    // The sweep itself completed — the other tenant still ran.
    expect(body.tenants_checked).toBe(2);
  });

  it('returns 500 when the sweep itself cannot run', async () => {
    mockSweepTenants.mockImplementationOnce(async () => {
      throw new Error('pool down');
    });

    const { POST } = await import('@/app/api/cron/subscription-check/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
  });
});

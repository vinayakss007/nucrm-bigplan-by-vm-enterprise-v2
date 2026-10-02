/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the usage-snapshot cron.
 *
 * public.snapshot_tenant_usage() is SECURITY INVOKER and INSERTs one row per
 * tenant into usage_snapshots in a single statement. That table's policy
 * (migration 0091) is
 *   USING / WITH CHECK
 *     tenant_id = NULLIF(current_setting('app.current_tenant'),'')::uuid
 *     OR NULLIF(current_setting('app.is_super_admin'),'')::boolean = true
 * so the only context that can satisfy WITH CHECK for every row at once is the
 * platform one — a single tenant's context fails the other tenants' rows, and
 * the bare `db` handle (empty GUCs) fails all of them. These tests pin the route
 * to withSecurityContext and to running the call INSIDE that transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

type SqlFragment = { text: string; values: unknown[] };

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockState = {
  txExecutes: [] as SqlFragment[],
  bareDbExecutes: [] as SqlFragment[],
  securityContextCalls: 0,
  snapshotCount: 47,
  /** Per-tenant aggregate rows the tenant sweep reads back. */
  metrics: new Map<string, { users_count: number; storage_used_mb: string; api_calls_count: number }>(),
};

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment => ({
    text: strings.join('?'),
    values,
  }),
}));

const mockWithSecurityContext = vi.fn(
  async (fn: (tx: { execute: (q: SqlFragment) => Promise<unknown> }) => Promise<unknown>) => {
    mockState.securityContextCalls++;
    // The fake tx mirrors the real transaction handle: a SET LOCAL
    // app.is_super_admin is in force for exactly this callback's statements.
    return fn({
      execute: async (query: SqlFragment) => {
        mockState.txExecutes.push(query);
        if (query.text.includes('UPDATE usage_snapshots')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [{ count: mockState.snapshotCount }], rowCount: 1 };
      },
    });
  },
);

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: mockWithSecurityContext,
}));

// The per-tenant aggregate reads go through the bare `db` handle, which is only
// safe because sweepTenants pins one connection for the whole sweep.
const mockSweepTenants = vi.fn(
  async (_context: string, body: (tenantId: string) => Promise<void>) => {
    for (const tenantId of [TENANT_A, TENANT_B]) await body(tenantId);
    return { visited: 2, skipped: [], failed: [] };
  },
);

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (...args: [string, (t: string) => Promise<void>]) => mockSweepTenants(...args),
}));

// The route must NOT run snapshot_tenant_usage() on the bare pool: a bare
// db.execute() there is a separate connection checkout, which loses the SET LOCAL
// context and reintroduces the RLS violation the fix exists to remove.
vi.mock('@/drizzle/db', () => ({
  db: {
    execute: async (query: SqlFragment) => {
      mockState.bareDbExecutes.push(query);
      const tenantId = String(query.values[0] ?? '');
      return { rows: [mockState.metrics.get(tenantId) ?? { users_count: 0, storage_used_mb: '0', api_calls_count: 0 }] };
    },
  },
}));

vi.mock('@/lib/crypto', () => ({ verifySecret: vi.fn(() => true) }));
vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue({ acquired: true, value: 'lock-1' }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return { apiError: vi.fn(() => NextResponse.json({ error: 'internal' }, { status: 500 })) };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/usage-snapshot', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('usage-snapshot cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.txExecutes.length = 0;
    mockState.bareDbExecutes.length = 0;
    mockState.securityContextCalls = 0;
    mockState.snapshotCount = 47;
    mockState.metrics = new Map([
      [TENANT_A, { users_count: 4, storage_used_mb: '12.5', api_calls_count: 30 }],
      [TENANT_B, { users_count: 1, storage_used_mb: '0', api_calls_count: 0 }],
    ]);
    mockSweepTenants.mockImplementation(async (_context, body) => {
      for (const tenantId of [TENANT_A, TENANT_B]) await body(tenantId);
      return { visited: 2, skipped: [], failed: [] };
    });
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const res = await POST(
      new Request('http://localhost/api/cron/usage-snapshot', { method: 'POST' }) as unknown as NextRequest,
    );

    expect(res.status).toBe(401);
    expect(mockState.securityContextCalls).toBe(0);
  });

  it('skips when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.skipped).toBe(true);
    expect(mockState.securityContextCalls).toBe(0);
  });

  it('calls snapshot_tenant_usage() inside the platform security context', async () => {
    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockState.securityContextCalls).toBeGreaterThanOrEqual(1);
    const insert = mockState.txExecutes.filter((q) => q.text.includes('snapshot_tenant_usage'));
    expect(insert).toHaveLength(1);
    expect(insert[0]!.text).toContain('public.snapshot_tenant_usage()');
  });

  it('never runs the function on the bare db handle, which would lose the context', async () => {
    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    await POST(makeRequest());

    expect(mockState.bareDbExecutes.some((q) => q.text.includes('snapshot_tenant_usage'))).toBe(false);
  });

  it('measures the per-user columns once per tenant, in the tenant sweep', async () => {
    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    await POST(makeRequest());

    // tenant_members and user_usage have no is_super_admin branch, so the only
    // context that can count them is the tenant's own.
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/usage-snapshot', expect.any(Function));
    const reads = mockState.bareDbExecutes.filter((q) => q.text.includes('tenant_members'));
    expect(reads).toHaveLength(2);
    for (const text of ['tenant_members', 'user_usage']) {
      expect(reads[0]!.text).toContain(text);
    }
    // Mirrors the function's own predicates.
    expect(reads[0]!.text).toContain("tm.status = 'active'");
    expect(reads[0]!.text).toContain('uu.api_calls_date = CURRENT_DATE');
  });

  it('writes those columns back in the platform context, where any tenant_id is allowed', async () => {
    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const body = await (await POST(makeRequest())).json();

    const updates = mockState.txExecutes.filter((q) => q.text.includes('UPDATE usage_snapshots'));
    expect(updates).toHaveLength(2);
    expect(updates[0]!.values).toEqual([4, '12.5', 30, TENANT_A]);
    expect(updates[1]!.values).toEqual([1, '0', 0, TENANT_B]);
    expect(body.rows_corrected).toBe(2);
    expect(body.tenants_checked).toBe(2);
  });

  it('reports the number of snapshots the function inserted', async () => {
    mockState.snapshotCount = 12;

    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.snapshots).toBe(12);
    expect(body.ok).toBe(true);
  });

  it('flips ok when a tenant could not be measured, instead of reporting a green run', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(false);
    expect(body.tenants_failed).toBe(1);
    expect(body.tenants_skipped).toBe(1);
  });

  it('skips the write-back entirely when no tenant was measured', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 0, skipped: [], failed: [],
    }));

    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.rows_corrected).toBe(0);
    expect(mockState.txExecutes.filter((q) => q.text.includes('UPDATE usage_snapshots'))).toHaveLength(0);
  });

  it('surfaces an RLS violation as a 500 instead of a silent green run', async () => {
    const { withSecurityContext } = await import('@/lib/db/rls');
    vi.mocked(withSecurityContext).mockImplementationOnce(async () => {
      throw new Error('new row violates row-level security policy for table "usage_snapshots"');
    });
    const { logError } = await import('@/lib/errors-server');

    const { POST } = await import('@/app/api/cron/usage-snapshot/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'cron/usage-snapshot' }),
    );
  });
});

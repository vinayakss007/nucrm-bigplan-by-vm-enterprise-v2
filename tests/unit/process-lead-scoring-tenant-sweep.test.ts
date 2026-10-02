/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the process-lead-scoring cron's per-tenant sweep.
 *
 * contacts / contact_scores / lead_scoring_rules carry the plain
 * `tenant_isolation` policy with no super-admin branch, so bulkScoreLeads() run
 * on the bare pool matched zero leads. The route must therefore score once per
 * tenant inside sweepTenants() — see lib/cron/tenant-scope.ts.
 *
 * '@/lib/cron/tenant-scope' is mocked so the body is invoked once per fixture
 * tenant, and the eligibility read is stubbed so the 'active'-only + owner
 * guards of the original route can be asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_A = '11111111-1111-4111-8111-111111111111';

const mockLock = { acquired: true, value: 'lock-1' };

async function defaultSweep(
  _context: string,
  body: (tenantId: string) => Promise<void>,
  tenants: string[] = [TENANT_A, TENANT_B],
): Promise<CronTenantSweep> {
  for (const tenantId of tenants) await body(tenantId);
  return { visited: tenants.length, skipped: [], failed: [] };
}

const mockSweepTenants = vi.fn((context: string, body: (t: string) => Promise<void>) => defaultSweep(context, body));
const mockBulkScoreLeads = vi.fn(async (_tenantId: string, _userId: string, _limit: number) => [
  { contactId: 'c1', score: 42, reason: '', factors: {} },
]);
const mockFindMany = vi.fn(async (_opts?: unknown) => [
  { id: TENANT_A, ownerId: OWNER_A },
  { id: TENANT_B, ownerId: null },
]);

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (t: string) => Promise<void>) => mockSweepTenants(context, body),
}));

vi.mock('drizzle-orm', () => ({
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
}));

vi.mock('@/drizzle/schema/core', () => ({
  tenants: { id: 'tenants.id', status: 'tenants.status', ownerId: 'tenants.owner_id' },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenants: {
        findMany: (opts: unknown) => mockFindMany(opts),
      },
    },
  },
}));

vi.mock('@/lib/ai/scoring', () => ({
  bulkScoreLeads: (...args: unknown[]) => mockBulkScoreLeads(...args),
}));

vi.mock('@/lib/auth/cron', () => ({
  verifyCronSecret: vi.fn(async () => true),
}));

vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue(mockLock),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));

function makeRequest(path = '/api/cron/process-lead-scoring'): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('process-lead-scoring cron — per-tenant sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSweepTenants.mockImplementation((context: string, body: (t: string) => Promise<void>) => defaultSweep(context, body));
    mockBulkScoreLeads.mockResolvedValue([{ contactId: 'c1', score: 42, reason: '', factors: {} }]);
    mockFindMany.mockResolvedValue([
      { id: TENANT_A, ownerId: OWNER_A },
      { id: TENANT_B, ownerId: null },
    ]);
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifyCronSecret } = await import('@/lib/auth/cron');
    vi.mocked(verifyCronSecret).mockResolvedValueOnce(false);

    const { POST } = await import('@/app/api/cron/process-lead-scoring/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('scores each eligible tenant inside the sweep, with the tenant\'s own owner as actor', async () => {
    const { POST } = await import('@/app/api/cron/process-lead-scoring/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/process-lead-scoring', expect.any(Function));
    // Tenant A is active and has an owner → scored with (tenant, owner, limit 20).
    expect(mockBulkScoreLeads).toHaveBeenCalledTimes(1);
    expect(mockBulkScoreLeads).toHaveBeenCalledWith(TENANT_A, OWNER_A, 20);
    // Tenant B keeps the original guard: no owner, no AI run.
    expect(mockBulkScoreLeads).not.toHaveBeenCalledWith(TENANT_B, expect.anything(), expect.anything());

    expect(body.ok).toBe(true);
    expect(body.tenants_checked).toBe(2);
    expect(body.tenants_skipped).toBe(0);
    expect(body.tenants_failed).toBe(0);
    expect(body.tenantsProcessed).toBe(2);
    expect(body.results).toEqual([{ tenantId: TENANT_A, scoredCount: 1 }]);
  });

  it('never scores a tenant the sweep visits but the job does not consider active', async () => {
    // The sweep enumerates every non-suspended tenant; the route's own
    // eligibility list stays 'active'-only, so an extra visited tenant must be
    // ignored rather than scored.
    mockFindMany.mockResolvedValue([{ id: TENANT_A, ownerId: OWNER_A }]);

    const { POST } = await import('@/app/api/cron/process-lead-scoring/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(mockBulkScoreLeads).toHaveBeenCalledTimes(1);
    expect(mockBulkScoreLeads).toHaveBeenCalledWith(TENANT_A, OWNER_A, 20);
    expect(body.tenants_checked).toBe(2);
    expect(body.tenantsProcessed).toBe(1);
    expect(body.results).toHaveLength(1);
  });

  it('reports tenant counters and flips ok when a tenant fails', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/process-lead-scoring/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(1);
    expect(body.tenants_failed).toBe(1);
  });

  it('skips the sweep entirely when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/process-lead-scoring/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.skipped).toBe(true);
    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(mockBulkScoreLeads).not.toHaveBeenCalled();
  });

  it('keeps the GET delegate on the same swept handler', async () => {
    const { GET } = await import('@/app/api/cron/process-lead-scoring/route');
    const res = await GET(makeRequest('/api/cron/process-lead-scoring'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tenants_checked).toBe(2);
    expect(mockSweepTenants).toHaveBeenCalled();
  });
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the lead-warming cron's per-tenant sweep.
 *
 * lead_warming_campaigns / _messages / _schedule / _replies and contacts carry
 * the plain `tenant_isolation` policy with no super-admin branch, so every
 * engine query ran against an empty row set on the bare pool: no campaigns, no
 * greetings queued, no replies analyzed, and the job still answered ok. The
 * route must therefore run the engine once per tenant inside sweepTenants() and
 * aggregate the per-tenant counters — see lib/cron/tenant-scope.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
const mockProcessLeadWarming = vi.fn(async () => ({
  campaignsProcessed: 1,
  messagesSent: 2,
  messagesQueued: 3,
  errors: [`tenant-err-${Math.random().toString(36).slice(2, 7)}`],
  skippedContacts: 4,
}));
const mockResetMonthlyCounters = vi.fn(async () => undefined);
const mockAnalyzeUnprocessedReplies = vi.fn(async (_limit: number) => ({ processed: 5, errors: 1 }));

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (t: string) => Promise<void>) => mockSweepTenants(context, body),
}));

vi.mock('@/lib/lead-warming/engine', () => ({
  processLeadWarming: () => mockProcessLeadWarming(),
  resetMonthlyCounters: () => mockResetMonthlyCounters(),
}));

vi.mock('@/lib/lead-warming/reply-analyzer', () => ({
  analyzeUnprocessedReplies: (limit: number) => mockAnalyzeUnprocessedReplies(limit),
}));

vi.mock('@/lib/crypto', () => ({
  verifySecret: vi.fn(() => true),
}));

vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue(mockLock),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    apiError: vi.fn(() => NextResponse.json({ error: 'internal' }, { status: 500 })),
  };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/lead-warming', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('lead-warming cron — per-tenant sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSweepTenants.mockImplementation((context: string, body: (t: string) => Promise<void>) => defaultSweep(context, body));
    mockProcessLeadWarming.mockResolvedValue({
      campaignsProcessed: 1,
      messagesSent: 2,
      messagesQueued: 3,
      errors: ['e'],
      skippedContacts: 4,
    });
    mockAnalyzeUnprocessedReplies.mockResolvedValue({ processed: 5, errors: 1 });
    mockResetMonthlyCounters.mockResolvedValue(undefined);
    // Mid-month by default: the monthly reset must not fire.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 4, 15, 9, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/lead-warming/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('runs the engine once per swept tenant and sums the per-tenant counters', async () => {
    const { POST } = await import('@/app/api/cron/lead-warming/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/lead-warming', expect.any(Function));
    expect(mockProcessLeadWarming).toHaveBeenCalledTimes(2);
    expect(mockAnalyzeUnprocessedReplies).toHaveBeenCalledTimes(2);
    // The reply batch cap is unchanged, it is now applied inside each tenant.
    expect(mockAnalyzeUnprocessedReplies).toHaveBeenCalledWith(50);

    expect(body.ok).toBe(true);
    expect(body.tenants_checked).toBe(2);
    expect(body.tenants_skipped).toBe(0);
    expect(body.tenants_failed).toBe(0);
    expect(body.warming).toEqual({
      campaignsProcessed: 2,
      messagesSent: 4,
      messagesQueued: 6,
      errors: ['e', 'e'],
      skippedContacts: 8,
    });
    expect(body.replies).toEqual({ processed: 10, errors: 2 });
    expect(body.monthlyReset).toBeUndefined();
  });

  it('resets monthly counters per tenant only on the 1st, keeping the flag in the response', async () => {
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0));

    const { POST } = await import('@/app/api/cron/lead-warming/route');
    const body = await (await POST(makeRequest())).json();

    // lead_warming_schedule is tenant-isolated, so the reset has to run inside
    // each tenant scope to touch that tenant's rows.
    expect(mockResetMonthlyCounters).toHaveBeenCalledTimes(2);
    expect(body.monthlyReset).toBe(true);
  });

  it('keeps the completion log line', async () => {
    const { POST } = await import('@/app/api/cron/lead-warming/route');
    await POST(makeRequest());

    expect(console.log).toHaveBeenCalledWith(
      '[cron/lead-warming] Completed:',
      expect.stringContaining('"warming"'),
    );
  });

  it('reports tenant counters and flips ok when a tenant fails', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/lead-warming/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(false);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(1);
    expect(body.tenants_failed).toBe(1);
  });

  it('skips the sweep entirely when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/lead-warming/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.skipped).toBe(true);
    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(mockProcessLeadWarming).not.toHaveBeenCalled();
  });
});

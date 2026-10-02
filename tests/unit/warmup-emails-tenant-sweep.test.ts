/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the warmup-emails cron's per-tenant sweep.
 *
 * email_warmup_configs is isolated by the plain `tenant_isolation` policy (no
 * super-admin branch) and email_warmup_pool / email_warmup_logs resolve their
 * tenant through the owning config, so an unscoped run on the bare pool matched
 * no configs at all: no warm-up mail was sent, yet the job returned ok. The
 * route must therefore run processWarmUp() once per tenant inside
 * sweepTenants() and aggregate its counters — see lib/cron/tenant-scope.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
const mockProcessWarmUp = vi.fn(async () => ({ tenantsProcessed: 0, emailsSent: 0, errors: [] as string[] }));

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (t: string) => Promise<void>) => mockSweepTenants(context, body),
}));

vi.mock('@/lib/email/warmup', () => ({
  processWarmUp: () => mockProcessWarmUp(),
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

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/warmup-emails', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('warmup-emails cron — per-tenant sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSweepTenants.mockImplementation((context: string, body: (t: string) => Promise<void>) => defaultSweep(context, body));
    mockProcessWarmUp.mockResolvedValue({ tenantsProcessed: 0, emailsSent: 0, errors: [] });
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/warmup-emails/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('runs the warm-up engine once per tenant and sums its counters', async () => {
    mockProcessWarmUp.mockResolvedValue({ tenantsProcessed: 1, emailsSent: 3, errors: ['config-1 paused'] });

    const { POST } = await import('@/app/api/cron/warmup-emails/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/warmup-emails', expect.any(Function));
    expect(mockProcessWarmUp).toHaveBeenCalledTimes(2);

    // Original response fields keep their meaning: per-config progress and the
    // engine's own error strings, now summed across the sweep.
    expect(body.tenantsProcessed).toBe(2);
    expect(body.emailsSent).toBe(6);
    expect(body.errors).toEqual(['config-1 paused', 'config-1 paused']);
    expect(body.tenants_checked).toBe(2);
    expect(body.tenants_skipped).toBe(0);
    expect(body.tenants_failed).toBe(0);
    expect(body.ok).toBe(true);
  });

  it('reports an empty run honestly when no tenant is swept', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 0,
      skipped: [{ tenantId: TENANT_A, reason: 'no-acting-user' }],
      failed: [],
    }));

    const { POST } = await import('@/app/api/cron/warmup-emails/route');
    const body = await (await POST(makeRequest())).json();

    expect(mockProcessWarmUp).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      ok: true,
      tenants_checked: 0,
      tenants_skipped: 1,
      tenants_failed: 0,
      tenantsProcessed: 0,
      emailsSent: 0,
    });
  });

  it('flips ok when a tenant fails mid-sweep', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [],
      failed: [{ tenantId: TENANT_B, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/warmup-emails/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(false);
    expect(body.tenants_failed).toBe(1);
  });

  it('returns a 500 when the sweep itself throws', async () => {
    mockSweepTenants.mockImplementationOnce(async () => {
      throw new Error('pool exhausted');
    });

    const { POST } = await import('@/app/api/cron/warmup-emails/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to process warmup' });
  });

  it('skips the sweep entirely when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/warmup-emails/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.skipped).toBe(true);
    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(mockProcessWarmUp).not.toHaveBeenCalled();
  });
});

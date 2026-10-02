/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for the process-at-risk cron's per-tenant sweep.
 *
 * at_risk_rules (plus the contacts/companies the engine joins) carries the plain
 * `tenant_isolation` policy with no super-admin branch, so getAtRiskDeals() run
 * on the bare pool found no rules and no rows and the digest mailed nobody while
 * still reporting ok. The route must therefore build each tenant's digest inside
 * sweepTenants() — see lib/cron/tenant-scope.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';

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
const mockGetAtRiskDeals = vi.fn(async (_tenantId: string): Promise<unknown[]> => []);
const mockSendEmail = vi.fn(async (_input: unknown) => ({ success: true }));
const mockSelectWhere = vi.fn(async (_condition?: unknown) => [{ id: TENANT_A }]);

vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (t: string) => Promise<void>) => mockSweepTenants(context, body),
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args.filter(Boolean),
  isNull: (column: unknown) => ({ __isNull: column }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.join('?'),
      values,
    }),
    {},
  ),
}));

vi.mock('@/drizzle/schema', () => ({
  tenants: { id: 'tenants.id', status: 'tenants.status', deletedAt: 'tenants.deleted_at' },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => mockSelectWhere(condition),
      }),
    }),
  },
}));

vi.mock('@/lib/ai/at-risk', () => ({
  getAtRiskDeals: (tenantId: string) => mockGetAtRiskDeals(tenantId),
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: (input: unknown) => mockSendEmail(input),
}));

vi.mock('@/lib/utils', () => ({
  formatCurrency: (amount: unknown) => `Rs.${amount}`,
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

function deal(id: string, assignedTo: string, assignedEmail: string, assignedName: string) {
  return {
    id,
    title: `Deal ${id}`,
    amount: '1000',
    stageName: 'Negotiation',
    contactName: 'Jane Doe',
    companyName: 'Acme',
    assignedTo,
    assignedEmail,
    assignedName,
    atRisk: {
      reasons: ['No activity for 30 days (Limit: 14)'],
      severity: 'medium' as const,
      idleDays: 30,
      stageDays: 5,
      currentSentiment: 100,
    },
  };
}

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/process-at-risk', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('process-at-risk cron — per-tenant sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSweepTenants.mockImplementation((context: string, body: (t: string) => Promise<void>) => defaultSweep(context, body));
    mockGetAtRiskDeals.mockResolvedValue([]);
    mockSendEmail.mockResolvedValue({ success: true });
    mockSelectWhere.mockResolvedValue([{ id: TENANT_A }]);
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockSweepTenants).not.toHaveBeenCalled();
  });

  it('builds the digest inside the sweep and keeps the eligibility list active/trialing only', async () => {
    mockGetAtRiskDeals.mockImplementation(async (tenantId: string) =>
      tenantId === TENANT_A
        ? [deal('d1', USER_1, 'rep-a@example.com', 'Rep A'), deal('d2', USER_1, 'rep-a@example.com', 'Rep A')]
        : [],
    );

    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSweepTenants).toHaveBeenCalledWith('cron/process-at-risk', expect.any(Function));
    // Only the tenant the route itself qualifies (active/trialing, not deleted)
    // is analysed; the other swept tenant is left alone.
    expect(mockGetAtRiskDeals).toHaveBeenCalledTimes(1);
    expect(mockGetAtRiskDeals).toHaveBeenCalledWith(TENANT_A);
    expect(mockGetAtRiskDeals).not.toHaveBeenCalledWith(TENANT_B);

    // Deals for one assignee are consolidated into a single email, unchanged.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(mockSendEmail).mock.calls[0]![0] as { to: string; subject: string };
    expect(mail.to).toBe('rep-a@example.com');
    expect(mail.subject).toBe('⚠️ Daily Digest: 2 At-Risk Deals in your Pipeline');

    expect(body).toMatchObject({
      ok: true,
      tenants_checked: 2,
      tenants_skipped: 0,
      tenants_failed: 0,
      tenants_processed: 1,
      deals_flagged: 2,
      emails_sent: 1,
    });
  });

  it('keeps the unscoped eligibility query on the tenants table unchanged', async () => {
    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    await POST(makeRequest());

    const condition = mockSelectWhere.mock.calls[0]![0] as unknown[];
    // and(isNull(deleted_at), sql`status IN ('active','trialing')`)
    expect(JSON.stringify(condition[0])).toContain('tenants.deleted_at');
    expect((condition[1] as { text: string }).text).toContain("IN ('active', 'trialing')");
  });

  it('counts eligible tenants that have no at-risk deals and sends them no mail', async () => {
    mockSelectWhere.mockResolvedValue([{ id: TENANT_A }, { id: TENANT_B }]);
    mockGetAtRiskDeals.mockResolvedValue([]);

    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    const body = await (await POST(makeRequest())).json();

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.tenants_processed).toBe(2);
    expect(body.deals_flagged).toBe(0);
    expect(body.emails_sent).toBe(0);
  });

  it('swallows an email failure the same way the original route did', async () => {
    mockGetAtRiskDeals.mockResolvedValue([deal('d1', USER_2, 'rep-b@example.com', 'Rep B')]);
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    const { logError } = await import('@/lib/errors-server');

    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.emails_sent).toBe(1);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ context: 'cron/process-at-risk email' }));
  });

  it('reports tenant counters and flips ok when a tenant fails', async () => {
    mockSweepTenants.mockImplementationOnce(async () => ({
      visited: 1,
      skipped: [{ tenantId: TENANT_B, reason: 'no-acting-user' }],
      failed: [{ tenantId: TENANT_A, error: 'boom' }],
    }));

    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.ok).toBe(false);
    expect(body.tenants_checked).toBe(1);
    expect(body.tenants_skipped).toBe(1);
    expect(body.tenants_failed).toBe(1);
  });

  it('skips the sweep entirely when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/process-at-risk/route');
    const body = await (await POST(makeRequest())).json();

    expect(body.skipped).toBe(true);
    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(mockGetAtRiskDeals).not.toHaveBeenCalled();
  });
});

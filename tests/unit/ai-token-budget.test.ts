/**
 * Unit tests for AI Token Budget enforcement.
 *
 * Tests checkAiTokenBudget and recordAiTokenUsage with mocked DB calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable mock data
let mockTenant: { planId: string } | undefined = { planId: 'pro' };
let mockUsageRow: { tokensUsed: number; tokensLimit: number | null } | undefined = undefined;
let insertCalledWith: unknown = null;
let onConflictSetArg: unknown = null;

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenants: {
        findFirst: vi.fn(async () => mockTenant),
      },
      aiTokenUsage: {
        findFirst: vi.fn(async () => mockUsageRow),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertCalledWith = vals;
        return {
          onConflictDoUpdate: vi.fn((opts: unknown) => {
            onConflictSetArg = opts;
            return {
              returning: vi.fn(() => [{ tokensUsed: 100 }]),
            };
          }),
        };
      }),
    })),
  },
}));

vi.mock('@/drizzle/schema/core', () => ({
  tenants: { id: 'id', planId: 'plan_id' },
}));

vi.mock('@/drizzle/schema/ai-token-usage', () => ({
  aiTokenUsage: {
    tenantId: 'tenant_id',
    billingPeriod: 'billing_period',
    tokensUsed: 'tokens_used',
    tokensLimit: 'tokens_limit',
  },
}));

vi.mock('@/lib/plans/plan-definitions', () => ({
  PLAN_MAP: {
    free: { maxAiTokensMonthly: 10000 },
    basic: { maxAiTokensMonthly: 100000 },
    pro: { maxAiTokensMonthly: 500000 },
    enterprise: { maxAiTokensMonthly: -1 },
  },
}));

vi.mock('@/lib/billing/period', () => ({
  getCurrentBillingPeriod: vi.fn(() => '2025-05'),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(vi.fn((...args: unknown[]) => ({ type: 'sql', args })), {
    raw: vi.fn(),
  }),
}));

describe('checkAiTokenBudget', () => {
  beforeEach(() => {
    mockTenant = { planId: 'pro' };
    mockUsageRow = undefined;
    insertCalledWith = null;
    onConflictSetArg = null;
  });

  it('allows when tenant has no usage row yet (first request)', async () => {
    mockTenant = { planId: 'basic' };
    mockUsageRow = undefined;

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-1');

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(100000);
    expect(result.remaining).toBe(100000);
  });

  it('allows when usage is below plan limit', async () => {
    mockTenant = { planId: 'pro' };
    mockUsageRow = { tokensUsed: 200000, tokensLimit: null };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-2');

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(200000);
    expect(result.limit).toBe(500000);
    expect(result.remaining).toBe(300000);
  });

  it('denies when usage reaches plan limit', async () => {
    mockTenant = { planId: 'free' };
    mockUsageRow = { tokensUsed: 10000, tokensLimit: null };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-3');

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(10000);
    expect(result.limit).toBe(10000);
    expect(result.remaining).toBe(0);
  });

  it('denies when usage exceeds plan limit', async () => {
    mockTenant = { planId: 'free' };
    mockUsageRow = { tokensUsed: 12000, tokensLimit: null };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-4');

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(12000);
    expect(result.limit).toBe(10000);
    expect(result.remaining).toBe(0);
  });

  it('uses super admin override when set', async () => {
    mockTenant = { planId: 'free' };
    mockUsageRow = { tokensUsed: 8000, tokensLimit: 50000 };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-5');

    // Override is 50000 instead of plan default 10000
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(50000);
    expect(result.remaining).toBe(42000);
  });

  it('respects override even when it is lower than plan default', async () => {
    mockTenant = { planId: 'pro' };
    mockUsageRow = { tokensUsed: 800, tokensLimit: 1000 };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-6');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(1000);
    expect(result.remaining).toBe(200);
  });

  it('allows unlimited for enterprise plan (limit = -1)', async () => {
    mockTenant = { planId: 'enterprise' };
    mockUsageRow = { tokensUsed: 9999999, tokensLimit: null };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-7');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
    expect(result.remaining).toBe(-1);
  });

  it('allows unlimited when override is -1', async () => {
    mockTenant = { planId: 'free' };
    mockUsageRow = { tokensUsed: 999999, tokensLimit: -1 };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-8');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
    expect(result.remaining).toBe(-1);
  });

  it('defaults to free plan limits when tenant has no plan', async () => {
    mockTenant = undefined;
    mockUsageRow = undefined;

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('unknown-tenant');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10000);
    expect(result.remaining).toBe(10000);
  });

  it('handles exact boundary - one token below limit is allowed', async () => {
    mockTenant = { planId: 'free' };
    mockUsageRow = { tokensUsed: 9999, tokensLimit: null };

    const { checkAiTokenBudget } = await import('@/lib/ai/check-budget');
    const result = await checkAiTokenBudget('tenant-boundary');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });
});

describe('recordAiTokenUsage', () => {
  beforeEach(() => {
    insertCalledWith = null;
    onConflictSetArg = null;
  });

  it('calls db.insert with correct tenant and billing period', async () => {
    const { recordAiTokenUsage } = await import('@/lib/ai/check-budget');
    const result = await recordAiTokenUsage('tenant-abc', 500);

    expect(result).toBe(true);
    expect(insertCalledWith).toEqual({
      tenantId: 'tenant-abc',
      billingPeriod: '2025-05',
      tokensUsed: 500,
    });
  });

  it('returns true for successful recording', async () => {
    const { recordAiTokenUsage } = await import('@/lib/ai/check-budget');
    const result = await recordAiTokenUsage('tenant-xyz', 1000);

    expect(result).toBe(true);
  });

  it('passes onConflictDoUpdate configuration', async () => {
    const { recordAiTokenUsage } = await import('@/lib/ai/check-budget');
    await recordAiTokenUsage('tenant-conflict', 250);

    expect(onConflictSetArg).not.toBeNull();
    expect((onConflictSetArg as Record<string, unknown>).target).toBeDefined();
  });
});

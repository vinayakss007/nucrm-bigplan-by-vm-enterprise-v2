import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning, onConflictDoUpdate: vi.fn() }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockLimit = vi.fn(() => Promise.resolve([]));
const mockOrderBy = vi.fn(() => ({
  limit: mockLimit,
  then: (resolve: (v: unknown[]) => void) => resolve([]),
}));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockActivityWhere = vi.fn();
const mockActivityFrom = vi.fn(() => ({ where: mockActivityWhere }));
const mockActivitySelect = vi.fn(() => ({ from: mockActivityFrom }));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      aiProviderSecrets: { findFirst: vi.fn(() => mockFindFirst()) },
      tenantAiCredits: { findFirst: vi.fn(() => mockFindFirst()) },
      tenants: { findFirst: vi.fn(() => mockFindFirst()) },
    },
    insert: mockInsert,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) })) })),
    select: vi.fn((fields?: unknown) => {
      if (fields && typeof fields === 'object') {
        const f = fields as Record<string, unknown>;
        if ('total' in f || 'successful' in f) {
          return { from: mockActivityFrom };
        }
      }
      return { from: mockFrom };
    }),
  },
}));

vi.mock('@/drizzle/schema/ai', () => ({ tenantAiCredits: {}, aiCreditsLedger: {}, aiProviderSecrets: {}, aiActivity: {} }));
vi.mock('@/drizzle/schema/core', () => ({ tenants: {} }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  desc: vi.fn((...a: unknown[]) => ({ type: 'desc', args: a })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

describe('ai/credits', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('isCentralizedProvider returns true when centralized secret exists', async () => {
    mockFindFirst.mockResolvedValue({ id: 'secret-1', isCentralized: true });
    const { isCentralizedProvider } = await import('@/lib/ai/credits');
    const result = await isCentralizedProvider('tenant-1', 'openai');
    expect(result).toBe(true);
  });

  it('isCentralizedProvider returns false when no secret', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { isCentralizedProvider } = await import('@/lib/ai/credits');
    const result = await isCentralizedProvider('tenant-1', 'openai');
    expect(result).toBe(false);
  });

  it('getCreditBalance returns balance for existing period', async () => {
    mockFindFirst.mockResolvedValue({ allocatedTokens: 100000, usedTokens: 25000, allocatedCostCents: 5000, usedCostCents: 1200, hardCapEnabled: true, softCapPct: 80, status: 'active' });
    const { getCreditBalance } = await import('@/lib/ai/credits');
    const balance = await getCreditBalance('tenant-1');
    expect(balance.remainingTokens).toBe(75000);
    expect(balance.remainingCostCents).toBe(3800);
  });

  it('getCreditBalance auto-creates credits for new period', async () => {
    const fc = { allocatedTokens: 0, usedTokens: 0, allocatedCostCents: 0, usedCostCents: 0, hardCapEnabled: true, softCapPct: 80, status: 'active' };
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(fc);
    mockReturning.mockResolvedValue([fc]);
    const { getCreditBalance } = await import('@/lib/ai/credits');
    const balance = await getCreditBalance('tenant-1');
    expect(balance.remainingTokens).toBe(0);
  });

  it('checkCredits allows when sufficient balance', async () => {
    mockFindFirst.mockResolvedValue({ allocatedTokens: 100000, usedTokens: 0, allocatedCostCents: 5000, usedCostCents: 0, hardCapEnabled: true, softCapPct: 80, status: 'active' });
    const { checkCredits } = await import('@/lib/ai/credits');
    expect((await checkCredits('tenant-1', 500)).allowed).toBe(true);
  });

  it('checkCredits blocks when suspended', async () => {
    mockFindFirst.mockResolvedValue({ allocatedTokens: 100000, usedTokens: 0, allocatedCostCents: 5000, usedCostCents: 0, hardCapEnabled: true, softCapPct: 80, status: 'suspended' });
    const { checkCredits } = await import('@/lib/ai/credits');
    const r = await checkCredits('tenant-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('suspended');
  });

  it('checkCredits blocks when exhausted', async () => {
    mockFindFirst.mockResolvedValue({ allocatedTokens: 100000, usedTokens: 100000, allocatedCostCents: 5000, usedCostCents: 5000, hardCapEnabled: true, softCapPct: 80, status: 'exhausted' });
    const { checkCredits } = await import('@/lib/ai/credits');
    expect((await checkCredits('tenant-1')).allowed).toBe(false);
  });

  it('checkCredits blocks when insufficient tokens', async () => {
    mockFindFirst.mockResolvedValue({ allocatedTokens: 1000, usedTokens: 900, allocatedCostCents: 5000, usedCostCents: 0, hardCapEnabled: true, softCapPct: 80, status: 'active' });
    const { checkCredits } = await import('@/lib/ai/credits');
    const r = await checkCredits('tenant-1', 500);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Insufficient');
  });

  it('checkCredits blocks when cost budget exhausted', async () => {
    mockFindFirst.mockResolvedValue({ allocatedTokens: 100000, usedTokens: 0, allocatedCostCents: 100, usedCostCents: 100, hardCapEnabled: true, softCapPct: 80, status: 'active' });
    const { checkCredits } = await import('@/lib/ai/credits');
    const r = await checkCredits('tenant-1', 500);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Cost budget');
  });

  it('deductCredits updates balance and logs to ledger', async () => {
    const balance = { allocatedTokens: 100000, usedTokens: 100, allocatedCostCents: 5000, usedCostCents: 10, hardCapEnabled: true, softCapPct: 80, status: 'active' };
    mockFindFirst.mockResolvedValue(balance);
    mockReturning.mockResolvedValue([]);
    const { deductCredits } = await import('@/lib/ai/credits');
    const result = await deductCredits({ tenantId: 'tenant-1', userId: 'user-1', action: 'chat', provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 150, costCents: 2, activityId: 'act-1' });
    expect(result.success).toBe(true);
  });

  it('deductCredits handles errors gracefully', async () => {
    const balance = { allocatedTokens: 100000, usedTokens: 100, allocatedCostCents: 5000, usedCostCents: 10, hardCapEnabled: true, softCapPct: 80, status: 'active' };
    mockFindFirst.mockResolvedValue(balance);
    mockReturning.mockRejectedValue(new Error('DB error'));
    const { deductCredits } = await import('@/lib/ai/credits');
    const result = await deductCredits({ tenantId: 'tenant-1', userId: 'user-1', action: 'chat', provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 150, costCents: 2, activityId: 'act-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('DB error');
  });

  it('allocateCredits inserts or updates credit allocation', async () => {
    const balance = { allocatedTokens: 100000, usedTokens: 0, allocatedCostCents: 5000, usedCostCents: 0, hardCapEnabled: true, softCapPct: 80, status: 'active' };
    mockFindFirst.mockResolvedValue(balance);
    const { allocateCredits } = await import('@/lib/ai/credits');
    const result = await allocateCredits({ tenantId: 'tenant-1', allocatedBy: 'admin-1', tokens: 50000, costCents: 2500 });
    expect(result.allocatedTokens).toBe(100000);
  });

  it('getCreditHistory returns ledger entries', async () => {
    const entry = { id: 'log-1', action: 'chat', provider: 'openai', model: 'gpt-4', tokensUsed: 100, costCents: 1, balanceAfterTokens: 99900, createdAt: new Date() };
    mockLimit.mockResolvedValue([entry]);
    const { getCreditHistory } = await import('@/lib/ai/credits');
    const history = await getCreditHistory('tenant-1');
    expect(history).toHaveLength(1);
  });

  it('getAggregatedUsage returns enriched tenant usage', async () => {
    mockFindFirst.mockResolvedValue({ name: 'Test Tenant' });
    mockLimit.mockResolvedValue([]);
    mockActivityWhere.mockResolvedValue([{ total: 10, successful: 8 }]);
    const { getAggregatedUsage } = await import('@/lib/ai/credits');
    const usage = await getAggregatedUsage();
    expect(Array.isArray(usage)).toBe(true);
  });
});

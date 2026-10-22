import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
const mockReturning = vi.fn();
const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockReturning }));
const mockValues = vi.fn(() => ({
  returning: mockReturning,
  onConflictDoUpdate: mockOnConflictDoUpdate,
  onConflictDoNothing: mockOnConflictDoNothing,
}));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockLimit = vi.fn(() => Promise.resolve([]));
const mockOrderBy = vi.fn(() => ({
  limit: mockLimit,
  then: (resolve: (v: unknown[]) => void) => resolve([]),
}));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));

const mockActivityWhere = vi.fn();
const mockActivityFrom = vi.fn(() => ({ where: mockActivityWhere }));

const mockCreditsTx = vi.hoisted(() => vi.fn<[(tx: unknown) => Promise<unknown>], unknown>());

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
    transaction: mockCreditsTx,
  },
}));

vi.mock('@/drizzle/schema/ai', () => ({ tenantAiCredits: {}, aiCreditsLedger: {}, aiProviderSecrets: {}, aiActivity: {} }));
vi.mock('@/drizzle/schema/core', () => ({ tenants: {} }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
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
    // vitest v4: restoreAllMocks no longer clears queued/resolved values on
    // plain vi.fn() mocks — reset shared stateful mocks explicitly.
    mockFindFirst.mockReset();
    mockReturning.mockReset();
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

  // #3081 — the auto-create was a bare check-then-insert against the
  // (tenant_id, billing_period) unique index: concurrent first calls of a
  // month made N-1 of them take a raw 23505 out of .returning() and 500.
  describe('#3081 credit status lifecycle', () => {
    beforeEach(() => {
      mockOnConflictDoNothing.mockClear();
      mockOnConflictDoUpdate.mockClear();
      mockValues.mockClear();
    });

    it('getCreditBalance survives a lost insert race via onConflictDoNothing + re-SELECT', async () => {
      const row = { allocatedTokens: 1000, usedTokens: 50, allocatedCostCents: 100, usedCostCents: 5, hardCapEnabled: true, softCapPct: 80, status: 'active' };
      // 1st findFirst: pre-check misses. Then the insert loses the race
      // (onConflictDoNothing -> returning() = []). 2nd findFirst: re-SELECT
      // reads the row the winner inserted.
      mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
      mockReturning.mockResolvedValueOnce([]);
      const { getCreditBalance } = await import('@/lib/ai/credits');
      const balance = await getCreditBalance('tenant-1');
      expect(mockOnConflictDoNothing).toHaveBeenCalled();
      expect(mockFindFirst).toHaveBeenCalledTimes(2);
      expect(balance.remainingTokens).toBe(950);
    });

    it('deductCredits keeps a suspended tenant suspended instead of flipping it to active', async () => {
      const { sql } = await import('drizzle-orm');
      const mockSet = vi.fn(() => ({ where: vi.fn() }));
      const balance = { allocatedTokens: 100000, usedTokens: 100, allocatedCostCents: 5000, usedCostCents: 10, hardCapEnabled: true, softCapPct: 80, status: 'suspended' };
      mockReturning.mockResolvedValue([]);
      (sql as ReturnType<typeof vi.fn>).mockClear();
      mockCreditsTx.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([balance]) })) })) })),
        update: vi.fn(() => ({ set: mockSet })),
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
      }));
      const { deductCredits } = await import('@/lib/ai/credits');
      const result = await deductCredits({ tenantId: 'tenant-1', userId: 'user-1', action: 'chat', provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 150, costCents: 2, activityId: 'act-1' });
      expect(result.success).toBe(true);
      // The status CASE must preserve an existing suspension; before #3081 it
      // only had exhausted/active branches, so any deduction un-suspended.
      const statusSqlCall = (sql as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => (call[0] as readonly string[]).join('').includes('suspended'),
      );
      expect(statusSqlCall, 'deduct CASE never mentions suspended — it overwrites the status').toBeDefined();
    });

    it('allocateCredits top-up does not overwrite the status of an existing row', async () => {
      const balance = { allocatedTokens: 100000, usedTokens: 0, allocatedCostCents: 5000, usedCostCents: 0, hardCapEnabled: true, softCapPct: 80, status: 'suspended' };
      mockFindFirst.mockResolvedValue(balance);
      const { allocateCredits } = await import('@/lib/ai/credits');
      await allocateCredits({ tenantId: 'tenant-1', allocatedBy: 'admin-1', tokens: 50000, costCents: 2500 });
      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
      const cfg = mockOnConflictDoUpdate.mock.calls[0]![0] as { set: Record<string, unknown> };
      expect(cfg.set, 'top-up still writes status — it lifts the suspend without reactivate').not.toHaveProperty('status');
    });
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
    mockCreditsTx.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([balance]) })) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
    }));
    const { deductCredits } = await import('@/lib/ai/credits');
    const result = await deductCredits({ tenantId: 'tenant-1', userId: 'user-1', action: 'chat', provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 150, costCents: 2, activityId: 'act-1' });
    expect(result.success).toBe(true);
  });

  it('deductCredits handles errors gracefully', async () => {
    const balance = { allocatedTokens: 100000, usedTokens: 100, allocatedCostCents: 5000, usedCostCents: 10, hardCapEnabled: true, softCapPct: 80, status: 'active' };
    mockFindFirst.mockResolvedValue(balance);
    mockCreditsTx.mockRejectedValue(new Error('DB error'));
    const { deductCredits } = await import('@/lib/ai/credits');
    const result = await deductCredits({ tenantId: 'tenant-1', userId: 'user-1', action: 'chat', provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 150, costCents: 2, activityId: 'act-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('DB error');
    const { logError } = await import('@/lib/errors-server');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'ai-credits: deductCredits' })
    );
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

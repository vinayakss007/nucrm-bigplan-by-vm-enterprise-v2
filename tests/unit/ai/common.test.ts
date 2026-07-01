import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTokenBudgetFind = vi.fn();
const mockDbFindOne = vi.fn();
const mockDailyCount = vi.fn();
const mockAnomalySelect = vi.fn();

const mockFrom = vi.fn(() => ({
  where: vi.fn(() => ({
    groupBy: vi.fn(() => ({
      as: vi.fn(() => ({})),
    })),
  })),
}));

const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tokenBudgets: { findFirst: vi.fn(() => mockTokenBudgetFind()) },
      tenantTokenLimits: { findFirst: vi.fn(() => mockDbFindOne()) },
      userTokenLimits: { findFirst: vi.fn(() => mockDbFindOne()) },
      aiUsageAggregated: { findFirst: vi.fn(() => mockDbFindOne()) },
      usageAlerts: { findFirst: vi.fn(() => mockDbFindOne()) },
    },
    select: mockSelect,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/tokens', () => ({
  tokenBudgets: {},
  tenantTokenLimits: {},
  userTokenLimits: {},
  apiKeysRegistry: {},
  usageAlerts: {},
  costAnomalies: {},
}));

vi.mock('@/drizzle/schema', () => ({
  aiUsageAggregated: {},
  aiUsageLogs: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  gt: vi.fn((...a: unknown[]) => ({ type: 'gt', args: a })),
  lt: vi.fn((...a: unknown[]) => ({ type: 'lt', args: a })),
  sql: Object.assign(
    vi.fn((..._args: unknown[]) => {
      const fn = (() => '') as unknown as ReturnType<typeof vi.fn>;
      fn.as = vi.fn((alias: string) => ({ type: 'sqlAs', alias }));
      return fn as unknown as ReturnType<typeof vi.fn<{ as: (a: string) => { type: string; alias: string } }>>;
    }),
    { raw: vi.fn() },
  ),
}));

describe('AI Token Budgets & Usage', () => {
  let mod: typeof import('@/lib/ai/common');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbFindOne.mockReset();
    mockTokenBudgetFind.mockReset();
    mockDailyCount.mockReset();
    mockAnomalySelect.mockReset();
    mod = await import('@/lib/ai/common');
  });

  describe('checkTokenAndLimits', () => {
    it('allows call when no budgets or limits exist', async () => {
      mockTokenBudgetFind.mockResolvedValue(null);
      mockDbFindOne.mockResolvedValue(null);

      const result = await mod.checkTokenAndLimits('tenant-1', 'user-1', 'lead_scoring', 'openai', 10);
      expect(result.allowed).toBe(true);
    });

    it('rejects when global budget is exhausted', async () => {
      mockTokenBudgetFind.mockResolvedValue({
        id: 'b1', service: 'openai', monthlyBudgetCents: 1000, currentMonthCents: 1000,
        hardCapEnabled: true, alertAt50pct: true, alertAt80pct: true, alertAt100pct: true,
        softCapEnabled: true, billingPeriod: '2026-06', resetDay: 1,
        createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      });
      mockDbFindOne.mockResolvedValue(null);

      const result = await mod.checkTokenAndLimits('tenant-1', 'user-1', 'lead_scoring', 'openai', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('PLATFORM_BUDGET_EXHAUSTED');
    });

    it('rejects when tenant limit exceeded', async () => {
      mockTokenBudgetFind.mockResolvedValue(null);
      mockDbFindOne
        .mockResolvedValueOnce({
          id: 'tl-1', tenantId: 'tenant-1', scoreMonthlyCnt: 5,
          followupMonthlyCnt: -1, whatsappMonthlyMsgs: -1, voiceMonthlyMins: -1,
          contentMonthlyGen: -1, proposalMonthlyGen: -1,
          totalMonthlyCost: -1, hardCapAction: 'block',
        })
        .mockResolvedValueOnce({ count: 5, costCents: 100 })
        .mockResolvedValueOnce(null);

      const result = await mod.checkTokenAndLimits('tenant-1', 'user-1', 'lead_scoring', 'openai', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('TENANT_LIMIT_EXCEEDED');
    });

    it('rejects when tenant cost limit exceeded', async () => {
      mockTokenBudgetFind.mockResolvedValue(null);
      mockDbFindOne
        .mockResolvedValueOnce({
          id: 'tl-1', tenantId: 'tenant-1', scoreMonthlyCnt: -1,
          followupMonthlyCnt: -1, whatsappMonthlyMsgs: -1, voiceMonthlyMins: -1,
          contentMonthlyGen: -1, proposalMonthlyGen: -1,
          totalMonthlyCost: 500, hardCapAction: 'alert_only',
        })
        .mockResolvedValueOnce({ count: 0, costCents: 600 })
        .mockResolvedValueOnce(null);

      const result = await mod.checkTokenAndLimits('tenant-1', 'user-1', 'lead_scoring', 'openai', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('TENANT_COST_LIMIT_EXCEEDED');
    });

    it('rejects when user daily limit reached', async () => {
      mockTokenBudgetFind.mockResolvedValue(null);
      mockDbFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'ul-1', tenantId: 'tenant-1', userId: 'user-1', module: 'lead_scoring',
          dailyLimit: 3, maxCostPerCall: -1,
        });

      mockDailyCount.mockResolvedValueOnce([{ count: 3 }]);
      const dailyFrom = vi.fn(() => ({
        where: vi.fn(() => mockDailyCount()),
      }));
      mockSelect.mockReturnValueOnce({ from: dailyFrom });

      const result = await mod.checkTokenAndLimits('tenant-1', 'user-1', 'lead_scoring', 'openai', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_DAILY_LIMIT_EXCEEDED');
    });

    it('rejects when call exceeds maxCostPerCall', async () => {
      mockTokenBudgetFind.mockResolvedValue(null);
      mockDbFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'ul-1', tenantId: 'tenant-1', userId: 'user-1', module: 'lead_scoring',
          dailyLimit: -1, maxCostPerCall: 5,
        });

      const result = await mod.checkTokenAndLimits('tenant-1', 'user-1', 'lead_scoring', 'openai', 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('CALL_TOO_EXPENSIVE');
    });
  });

  describe('recordUsage', () => {
    it('records without throwing', async () => {
      await expect(mod.recordUsage('t-1', 'u-1', 'lead_scoring', 'openai', 50, 100)).resolves.not.toThrow();
    });

    it('records with response data', async () => {
      await expect(mod.recordUsage('t-1', 'u-1', 'lead_scoring', 'openai', 50, 100, { model: 'gpt-4' })).resolves.not.toThrow();
    });
  });

  describe('checkForAnomaly', () => {
    it('returns null when no history', async () => {
      const result = await mod.checkForAnomaly('tenant-1', 'openai', 100);
      expect(result).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelectResolve = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          leftJoin: vi.fn(() => chain),
          where: vi.fn(() => mockDbSelectResolve()),
        };
        return chain;
      }),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  deals: { id: 'id', tenantId: 'tenant_id', title: 'title', amount: 'amount', stageId: 'stage_id', contactId: 'contact_id', companyId: 'company_id', assignedTo: 'assigned_to', updatedAt: 'updated_at', stageEnteredAt: 'stage_entered_at', metadata: 'metadata', deletedAt: 'deleted_at' },
  atRiskRules: { id: 'id', tenantId: 'tenant_id', stageId: 'stage_id', maxDaysIdle: 'max_days_idle', maxDaysInStage: 'max_days_in_stage', sentimentThreshold: 'sentiment_threshold', active: 'active', deletedAt: 'deleted_at' },
  dealStages: { id: 'id', name: 'name' },
  contacts: { id: 'id', firstName: 'first_name', lastName: 'last_name' },
  companies: { id: 'id', name: 'name' },
  users: { id: 'id', email: 'email', fullName: 'full_name' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  sql: Object.assign(vi.fn(() => ({ type: 'sql' })), { raw: vi.fn() }),
}));

describe('AI At-Risk Deals', () => {
  let mod: typeof import('@/lib/ai/at-risk');
  const now = new Date('2026-06-20T12:00:00Z');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.setSystemTime(now);
    mod = await import('@/lib/ai/at-risk');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function deal(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deal-1', title: 'Big Deal', amount: '100000', stageId: 'stage-1',
      contactFirst: 'John', contactLast: 'Doe', companyName: 'Acme Inc',
      assignedTo: 'u-1', assignedEmail: 'r@a.com', assignedName: 'Rep Name',
      stageName: 'Negotiation',
      updatedAt: new Date(now.getTime() - 2 * 86400000),
      stageEnteredAt: new Date(now.getTime() - 5 * 86400000),
      metadata: {},
      ...overrides,
    };
  }

  describe('getAtRiskDeals', () => {
    it('returns empty when no rules flag deals', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'gr', tenantId: 't-1', stageId: null, maxDaysIdle: 30, maxDaysInStage: null, sentimentThreshold: 20, description: 'Lenient', active: true, deletedAt: null }])
        .mockResolvedValueOnce([deal()]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r).toHaveLength(0);
    });

    it('flags deal idle too long', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'gr', tenantId: 't-1', stageId: null, maxDaysIdle: 1, maxDaysInStage: null, sentimentThreshold: 0, description: 'Strict', active: true, deletedAt: null }])
        .mockResolvedValueOnce([deal()]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r).toHaveLength(1);
      expect(r[0].atRisk.reasons[0]).toContain('No activity');
    });

    it('flags deal stuck in stage', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'sr', tenantId: 't-1', stageId: 'stage-1', maxDaysIdle: 99, maxDaysInStage: 2, sentimentThreshold: 0, description: 'Stage rule', active: true, deletedAt: null }])
        .mockResolvedValueOnce([deal({ stageId: 'stage-1' })]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r).toHaveLength(1);
      expect(r[0].atRisk.reasons.some((x: string) => x.includes('Stuck in'))).toBe(true);
    });

    it('flags high severity for multiple triggers', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'gr', tenantId: 't-1', stageId: null, maxDaysIdle: 1, maxDaysInStage: null, sentimentThreshold: 50, description: 'Strict', active: true, deletedAt: null }])
        .mockResolvedValueOnce([deal({ updatedAt: new Date(now.getTime() - 10 * 86400000), metadata: { ai_sentiment: { score: 20 } } })]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r).toHaveLength(1);
      expect(r[0].atRisk.severity).toBe('high');
    });

    it('stage-specific rule overrides global', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([
          { id: 'global', tenantId: 't-1', stageId: null, maxDaysIdle: 99, maxDaysInStage: null, sentimentThreshold: 0, description: 'Lenient', active: true, deletedAt: null },
          { id: 'specific', tenantId: 't-1', stageId: 'stage-2', maxDaysIdle: 1, maxDaysInStage: null, sentimentThreshold: 0, description: 'Strict for S2', active: true, deletedAt: null },
        ])
        .mockResolvedValueOnce([deal({ stageId: 'stage-2', updatedAt: new Date(now.getTime() - 5 * 86400000) })]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r).toHaveLength(1);
      expect(r[0].atRisk.reasons[0]).toContain('5 days');
    });

    it('returns empty when no rules exist', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([deal()]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r).toHaveLength(0);
    });

    it('populates contact, company, assignee info', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'gr', tenantId: 't-1', stageId: null, maxDaysIdle: 1, maxDaysInStage: null, sentimentThreshold: 0, description: 'S', active: true, deletedAt: null }])
        .mockResolvedValueOnce([deal()]);

      const r = await mod.getAtRiskDeals('t-1');
      expect(r[0].contactName).toBe('John Doe');
      expect(r[0].companyName).toBe('Acme Inc');
      expect(r[0].assignedName).toBe('Rep Name');
    });
  });
});

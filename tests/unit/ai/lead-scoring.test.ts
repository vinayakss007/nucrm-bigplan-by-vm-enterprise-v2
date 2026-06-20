import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.fn();
const mockDbFindFirst = vi.fn();
const mockDbFindMany = vi.fn();

vi.mock('@/lib/ai/gateway', () => ({ chat: mockChat }));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      leads: {
        findFirst: vi.fn(() => mockDbFindFirst()),
        findMany: vi.fn(() => mockDbFindMany()),
      },
      leadScoringRules: { findMany: vi.fn(() => mockDbFindMany()) },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  leads: {},
  leadScoringRules: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  desc: vi.fn((...a: unknown[]) => ({ type: 'desc', args: a })),
  sql: Object.assign(vi.fn(() => ({ type: 'sql' })), { raw: vi.fn() }),
}));

describe('Lead Scoring Engine', () => {
  let mod: typeof import('@/lib/ai/lead-scoring');

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import('@/lib/ai/lead-scoring');
  });

  describe('computeLeadScore', () => {
    it('scores with AI augmentation', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'l1', tenantId: 't-1', firstName: 'Alice', lastName: 'J',
        companyName: 'TechCorp', title: 'CEO', source: 'web', leadStatus: 'new',
        email: 'a@t.com', notes: 'Interested', score: 0, updatedAt: new Date(), metadata: {}, deletedAt: null,
      });
      mockDbFindMany.mockResolvedValueOnce([
        { id: 'r1', factor: 'title_seniority', weight: 25, active: true, deletedAt: null },
      ]);
      mockChat.mockResolvedValueOnce({
        text: JSON.stringify({ score: 78, reason: 'Senior', next_action: 'Demo' }),
        provider: 'openai', model: 'gpt', tokensIn: 100, tokensOut: 30, latencyMs: 500, fallbacksUsed: 0, activityId: 'a1',
      });

      const r = await mod.computeLeadScore('t-1', 'l1', { useAI: true, userId: 'u-1' });
      expect(r.score).toBe(78);
      expect(r.ai_analysis?.reason).toBe('Senior');
    });

    it('defaults to 50 on AI failure', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'l2', tenantId: 't-1', firstName: 'B', lastName: 'S', companyName: null,
        title: null, source: 'ref', leadStatus: 'contacted', email: 'b@t.com',
        notes: null, score: 0, updatedAt: new Date(), metadata: {}, deletedAt: null,
      });
      mockDbFindMany.mockResolvedValueOnce([]);
      mockChat.mockRejectedValueOnce(new Error('AI fail'));

      const r = await mod.computeLeadScore('t-1', 'l2', { useAI: true, userId: 'u-1' });
      expect(r.score).toBe(50);
    });

    it('returns 0 when AI not used', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'l3', tenantId: 't-1', firstName: 'C', lastName: 'B', companyName: null,
        title: null, source: 'm', leadStatus: 'new', email: 'c@t.com', notes: null,
        score: 0, updatedAt: new Date(), metadata: {}, deletedAt: null,
      });
      mockDbFindMany.mockResolvedValueOnce([]);
      const r = await mod.computeLeadScore('t-1', 'l3', { useAI: false });
      expect(r.score).toBe(0);
      expect(r.ai_analysis).toBeUndefined();
    });

    it('throws when lead not found', async () => {
      mockDbFindFirst.mockResolvedValueOnce(null);
      await expect(mod.computeLeadScore('t-1', 'none')).rejects.toThrow('Lead not found');
    });
  });

  describe('recomputeAllLeads', () => {
    it('recomputes scores for all active leads', async () => {
      mockDbFindMany
        .mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }])
        .mockResolvedValue([]);
      mockDbFindFirst
        .mockResolvedValueOnce({
          id: 'l1', tenantId: 't-1', firstName: 'E', lastName: 'A', companyName: 'S',
          title: 'F', source: 'w', leadStatus: 'new', email: 'e@s.com', notes: '',
          score: 0, updatedAt: new Date(), metadata: {}, deletedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'l2', tenantId: 't-1', firstName: 'F', lastName: 'L', companyName: 'B',
          title: 'M', source: 'r', leadStatus: 'contacted', email: 'f@b.com', notes: '',
          score: 0, updatedAt: new Date(), metadata: {}, deletedAt: null,
        });
      mockChat.mockResolvedValue({
        text: JSON.stringify({ score: 70, reason: 'Good', next_action: 'Nurture' }),
        provider: 'openai', model: 'gpt', tokensIn: 50, tokensOut: 20, latencyMs: 300, fallbacksUsed: 0, activityId: 'ar',
      });

      const r = await mod.recomputeAllLeads('t-1', 'u-1', { limit: 100 });
      expect(r.count).toBe(2);
    });

    it('handles individual failures', async () => {
      mockDbFindMany.mockResolvedValueOnce([{ id: 'l-ok' }, { id: 'l-fail' }]);
      mockDbFindFirst
        .mockResolvedValueOnce({
          id: 'l-ok', tenantId: 't-1', firstName: 'G', lastName: 'L', companyName: null,
          title: null, source: 'a', leadStatus: 'new', email: 'g@t.com', notes: null,
          score: 0, updatedAt: new Date(), metadata: {}, deletedAt: null,
        })
        .mockRejectedValueOnce(new Error('DB error'));
      mockChat.mockResolvedValue({
        text: JSON.stringify({ score: 50, reason: 'Avg', next_action: 'Review' }),
        provider: 'openai', model: 'gpt', tokensIn: 30, tokensOut: 10, latencyMs: 200, fallbacksUsed: 0, activityId: 'aok',
      });

      const r = await mod.recomputeAllLeads('t-1', 'u-1');
      expect(r.count).toBe(1);
    });
  });
});

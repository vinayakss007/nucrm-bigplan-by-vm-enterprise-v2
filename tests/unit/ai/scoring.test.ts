import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.fn();
const mockDbFindMany = vi.fn();
const mockDbFindFirst = vi.fn();
const mockBulkSelect = vi.fn();

const mkFrom = vi.fn(() => ({
  leftJoin: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn(() => mockBulkSelect()),
    })),
  })),
}));

vi.mock('@/lib/ai/gateway', () => ({ chat: mockChat }));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      leadScoringRules: { findMany: vi.fn(() => mockDbFindMany()) },
      contacts: { findFirst: vi.fn(() => mockDbFindFirst()) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    })),
    select: vi.fn(() => ({ from: mkFrom })),
  },
}));

vi.mock('@/drizzle/schema/ai', () => ({
  leadScoringRules: {},
  atRiskRules: {},
  aiActivity: {},
}));

vi.mock('@/drizzle/schema/crm', () => ({
  contacts: {},
  contactScores: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  asc: vi.fn((...a: unknown[]) => ({ type: 'asc', args: a })),
  sql: Object.assign(vi.fn(() => ({ type: 'sql' })), { raw: vi.fn() }),
}));

describe('AI Scoring', () => {
  let mod: typeof import('@/lib/ai/scoring');

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import('@/lib/ai/scoring');
  });

  describe('scoreLead', () => {
    it('scores a lead and persists', async () => {
      mockDbFindMany.mockResolvedValueOnce([
        { id: 'r1', factor: 'email_engagement', weight: 30, condition: 'opened', sortOrder: 1, active: true, deletedAt: null },
      ]);
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'j@t.com',
        jobTitle: 'CTO', phone: '+1', leadSource: 'web', leadStatus: 'new', lifecycleStage: 'lead',
      });
      mockChat.mockResolvedValueOnce({
        text: JSON.stringify({ score: 85, reason: 'Strong fit', factors: { engagement: 30 } }),
        provider: 'openai', model: 'gpt-4o-mini', tokensIn: 100, tokensOut: 50,
        latencyMs: 800, fallbacksUsed: 0, activityId: 'a1',
      });

      const r = await mod.scoreLead('t-1', 'u-1', 'c1');
      expect(r.score).toBe(85);
      expect(r.reason).toBe('Strong fit');
    });

    it('clamps score to 0-100', async () => {
      mockDbFindMany.mockResolvedValueOnce([]);
      mockDbFindFirst.mockResolvedValueOnce({ id: 'c2', firstName: 'J', lastName: 'S', email: 'j@s.com', jobTitle: null, phone: null, leadSource: 'ref', leadStatus: 'new', lifecycleStage: 'lead' });
      mockChat.mockResolvedValueOnce({ text: JSON.stringify({ score: 999, reason: 'high', factors: {} }), provider: 'openai', model: 'gpt', tokensIn: 10, tokensOut: 5, latencyMs: 100, fallbacksUsed: 0, activityId: 'a2' });
      const r = await mod.scoreLead('t-1', 'u-1', 'c2');
      expect(r.score).toBe(100);
    });

    it('throws when lead not found', async () => {
      mockDbFindMany.mockResolvedValueOnce([]);
      mockDbFindFirst.mockResolvedValueOnce(null);
      await expect(mod.scoreLead('t-1', 'u-1', 'none')).rejects.toThrow('Lead not found');
    });

    it('falls back to default score when AI returns non-JSON', async () => {
      mockDbFindMany.mockResolvedValueOnce([]);
      mockDbFindFirst.mockResolvedValueOnce({ id: 'c3', firstName: 'T', lastName: 'U', email: 't@t.com', jobTitle: null, phone: null, leadSource: 'api', leadStatus: 'new', lifecycleStage: 'lead' });
      mockChat.mockResolvedValueOnce({ text: 'Sorry, cannot process', provider: 'openai', model: 'gpt', tokensIn: 10, tokensOut: 2, latencyMs: 100, fallbacksUsed: 0, activityId: 'a3' });
      const r = await mod.scoreLead('t-1', 'u-1', 'c3');
      expect(r.score).toBe(50);
      expect(r.reason).toContain('Sorry, cannot process');
    });

    it('extracts JSON from markdown fences', async () => {
      mockDbFindMany.mockResolvedValueOnce([]);
      mockDbFindFirst.mockResolvedValueOnce({ id: 'c4', firstName: 'A', lastName: 'B', email: 'a@b.com', jobTitle: null, phone: null, leadSource: 'm', leadStatus: 'q', lifecycleStage: 'opp' });
      mockChat.mockResolvedValueOnce({ text: '```json\n{"score": 72, "reason": "Good", "factors": {}}\n```', provider: 'openai', model: 'gpt', tokensIn: 10, tokensOut: 5, latencyMs: 100, fallbacksUsed: 0, activityId: 'a4' });
      const r = await mod.scoreLead('t-1', 'u-1', 'c4');
      expect(r.score).toBe(72);
    });
  });

  describe('bulkScoreLeads', () => {
    it('scores multiple leads', async () => {
      mockBulkSelect.mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]);
      mockDbFindMany.mockResolvedValue([]);
      mockDbFindFirst.mockResolvedValue({ id: 'c', firstName: 'B', lastName: 'L', email: 'b@l.com', jobTitle: null, phone: null, leadSource: 'i', leadStatus: 'n', lifecycleStage: 'l' });
      mockChat.mockResolvedValue({ text: JSON.stringify({ score: 60, reason: 'ok', factors: {} }), provider: 'openai', model: 'gpt', tokensIn: 10, tokensOut: 5, latencyMs: 100, fallbacksUsed: 0, activityId: 'ab' });

      const results = await mod.bulkScoreLeads('t-1', 'u-1', 20);
      expect(results).toHaveLength(2);
    });

    it('handles individual failures', async () => {
      mockBulkSelect.mockResolvedValueOnce([{ id: 'c-ok' }, { id: 'c-fail' }]);
      mockDbFindMany.mockResolvedValue([]);
      mockDbFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c-fail', firstName: 'F', lastName: 'C', email: 'f@c.com', jobTitle: null, phone: null, leadSource: 'a', leadStatus: 'n', lifecycleStage: 'l' });

      const results = await mod.bulkScoreLeads('t-1', 'u-1', 20);
      expect(results).toHaveLength(1);
    });
  });
});

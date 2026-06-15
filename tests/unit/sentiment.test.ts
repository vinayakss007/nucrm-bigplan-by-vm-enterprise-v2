import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockChat = vi.fn();
const mockDbQuery = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbUpdateChain: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUpdateWhere: any;

vi.mock('@/lib/ai/gateway', () => ({
  chat: mockChat,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    update: vi.fn(() => dbUpdateChain),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockDbQuery()),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/crm', () => ({
  deals: {
    id: 'id',
    tenantId: 'tenant_id',
    contactId: 'contact_id',
    metadata: 'metadata',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  isNull: vi.fn((...args: unknown[]) => ({ type: 'isNull', args })),
  sql: Object.assign(
    vi.fn(() => ({ type: 'sql' })),
    { raw: vi.fn() },
  ),
}));

describe('AI Sentiment Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbUpdateChain = {
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    };
  });

  describe('analyzeSentiment', () => {
    it('returns parsed sentiment result from AI gateway', async () => {
      mockChat.mockResolvedValueOnce({
        text: JSON.stringify({ score: 85, label: 'positive', confidence: 90, summary: 'Very positive tone' }),
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensIn: 50,
        tokensOut: 30,
        latencyMs: 500,
        fallbacksUsed: 0,
        activityId: 'act-1',
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('This is great! Thank you so much!', 'tenant-1', 'user-1');

      expect(result.score).toBe(85);
      expect(result.label).toBe('positive');
      expect(result.confidence).toBe(90);
      expect(result.summary).toBe('Very positive tone');
      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'sentiment_analysis',
        }),
      );
    });

    it('handles null userId gracefully', async () => {
      mockChat.mockResolvedValueOnce({
        text: JSON.stringify({ score: 50, label: 'neutral', confidence: 80, summary: 'Neutral' }),
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensIn: 50,
        tokensOut: 30,
        latencyMs: 300,
        fallbacksUsed: 0,
        activityId: 'act-2',
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('Just a regular message', 'tenant-1', null);

      expect(result.score).toBe(50);
      expect(result.label).toBe('neutral');
      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null }),
      );
    });

    it('strips markdown code fences from AI response', async () => {
      mockChat.mockResolvedValueOnce({
        text: '```json\n{"score": 30, "label": "negative", "confidence": 85, "summary": "Frustrated tone"}\n```',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensIn: 50,
        tokensOut: 30,
        latencyMs: 400,
        fallbacksUsed: 0,
        activityId: 'act-3',
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('This is terrible', 'tenant-1');

      expect(result.score).toBe(30);
      expect(result.label).toBe('negative');
    });

    it('falls back to rule-based analysis when AI response is not JSON', async () => {
      mockChat.mockResolvedValueOnce({
        text: 'Sorry, I cannot process this request.',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensIn: 50,
        tokensOut: 5,
        latencyMs: 200,
        fallbacksUsed: 0,
        activityId: 'act-4',
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('Some text', 'tenant-1');

      // Should return fallback (neutral)
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.confidence).toBe(40);
    });
  });

  describe('fallbackSentiment (via analyzeSentiment error path)', () => {
    it('detects positive keywords in fallback', async () => {
      mockChat.mockRejectedValueOnce(new Error('AI gateway error'));

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('Great service! Very happy with the product.', 'tenant-1');

      expect(result.score).toBeGreaterThan(50);
      expect(result.label).toBe('positive');
    });

    it('detects negative keywords in fallback', async () => {
      mockChat.mockRejectedValueOnce(new Error('AI gateway error'));

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('This is terrible and bad service.', 'tenant-1');

      expect(result.score).toBeLessThan(50);
      expect(result.label).toBe('negative');
    });
  });

  describe('updateDealSentiment', () => {
    it('updates deal metadata with sentiment data using jsonb_set', async () => {
      const { updateDealSentiment } = await import('@/lib/ai/sentiment');

      await updateDealSentiment(
        'deal-1',
        'tenant-1',
        { score: 80, label: 'positive', confidence: 90, summary: 'Good sentiment' },
      );

      expect(dbUpdateChain.set).toHaveBeenCalledOnce();
      const setArg = dbUpdateChain.set.mock.calls[0][0];
      expect(setArg.metadata).toBeDefined();
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateContactDealsSentiment', () => {
    it('updates all open deals for a contact', async () => {
      mockDbQuery.mockResolvedValueOnce([
        { id: 'deal-1' },
        { id: 'deal-2' },
      ]);

      const { updateContactDealsSentiment } = await import('@/lib/ai/sentiment');
      const count = await updateContactDealsSentiment(
        'contact-1',
        'tenant-1',
        { score: 70, label: 'positive', confidence: 85, summary: 'Positive reply' },
      );

      expect(count).toBe(2);
    });

    it('returns 0 when contact has no open deals', async () => {
      mockDbQuery.mockResolvedValueOnce([]);

      const { updateContactDealsSentiment } = await import('@/lib/ai/sentiment');
      const count = await updateContactDealsSentiment(
        'contact-1',
        'tenant-1',
        { score: 50, label: 'neutral', confidence: 80, summary: 'Neutral reply' },
      );

      expect(count).toBe(0);
    });
  });
});

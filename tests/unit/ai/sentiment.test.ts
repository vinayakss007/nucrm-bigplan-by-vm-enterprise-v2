import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/gateway', () => ({
  chat: vi.fn(),
}));

describe('ai/sentiment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('analyzeSentiment', () => {
    it('returns parsed sentiment result from AI response', async () => {
      const { chat } = await import('@/lib/ai/gateway');
      (chat as any).mockResolvedValue({
        text: JSON.stringify({ score: 85, label: 'positive', confidence: 90, summary: 'Very positive tone' }),
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('This is great!', 'tenant-1', 'user-1');
      expect(result.score).toBe(85);
      expect(result.label).toBe('positive');
      expect(result.confidence).toBe(90);
    });

    it('strips markdown code fences from AI response', async () => {
      const { chat } = await import('@/lib/ai/gateway');
      (chat as any).mockResolvedValue({
        text: '```json\n{"score": 30, "label": "negative", "confidence": 75, "summary": "Negative sentiment"}\n```',
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('This is bad', 'tenant-1');
      expect(result.score).toBe(30);
      expect(result.label).toBe('negative');
    });

    it('uses fallback when AI response is invalid JSON', async () => {
      const { chat } = await import('@/lib/ai/gateway');
      (chat as any).mockResolvedValue({ text: 'not json at all' });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('Terrible experience', 'tenant-1');
      expect(result.label).toBe('negative');
      expect(result.confidence).toBe(40);
    });

    it('uses fallback when AI call throws', async () => {
      const { chat } = await import('@/lib/ai/gateway');
      (chat as any).mockRejectedValue(new Error('AI gateway error'));

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('great very happy excellent perfect', 'tenant-1');
      expect(result.label).toBe('positive');
    });

    it('returns neutral for mixed sentiment text via fallback', async () => {
      const { chat } = await import('@/lib/ai/gateway');
      (chat as any).mockRejectedValue(new Error('error'));

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('The product is okay', 'tenant-1');
      expect(result.label).toBe('neutral');
    });

    it('clamps score to 0-100 range', async () => {
      const { chat } = await import('@/lib/ai/gateway');
      (chat as any).mockResolvedValue({
        text: JSON.stringify({ score: 999, label: 'positive', confidence: 200, summary: 'Out of range' }),
      });

      const { analyzeSentiment } = await import('@/lib/ai/sentiment');
      const result = await analyzeSentiment('test', 'tenant-1');
      expect(result.score).toBe(100);
      expect(result.confidence).toBe(100);
    });
  });
});

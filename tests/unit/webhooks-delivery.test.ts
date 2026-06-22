import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbFindFirst = vi.fn();
const mockDbInsertReturning = vi.fn();
const mockDbUpdateChain = { set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) };
const mockDbSelectResolve = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      webhookDeliveries: {
        findFirst: vi.fn(() => mockDbFindFirst()),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => mockDbInsertReturning()),
      })),
    })),
    update: vi.fn(() => mockDbUpdateChain),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockDbSelectResolve()),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/automation', () => ({
  webhookDeliveries: { id: 'id', tenantId: 'tenant_id', webhookId: 'webhook_id', eventType: 'event_type', status: 'status', payload: 'payload', createdAt: 'created_at', responseStatus: 'response_status', responseBody: 'response_body', durationMs: 'duration_ms', metadata: 'metadata' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a) => ({ type: 'eq', args: a })),
  and: vi.fn((...a) => ({ type: 'and', args: a })),
  sql: Object.assign(vi.fn((...a) => ({ type: 'sql', args: a })), { raw: vi.fn() }),
  gt: vi.fn((...a) => ({ type: 'gt', args: a })),
}));

vi.mock('@/lib/dev-logger', () => ({
  devLogger: { queue: vi.fn(), error: vi.fn() },
}));

const OLD_ENV = process.env;

describe('Webhook Delivery', () => {
  let mod: typeof import('@/lib/webhooks/delivery');

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, WEBHOOK_SECRET: 'test-webhook-secret' };
    mod = await import('@/lib/webhooks/delivery');
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('queueWebhook', () => {
    it('inserts a delivery and returns id', async () => {
      mockDbInsertReturning.mockResolvedValueOnce([{ id: 'del-1' }]);
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'del-1', webhookId: 'wh-1', eventType: 'contact.created',
        payload: { foo: 'bar' }, status: 'pending', metadata: {},
        url: 'https://example.com/webhook',
      });
      globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: () => 'OK' });

      const result = await mod.queueWebhook({
        id: 'wh-1', tenant_id: 't-1', url: 'https://example.com/webhook',
        event: 'contact.created', payload: { foo: 'bar' },
      });

      expect(result).toBe('del-1');
    });

    it('throws when insert fails', async () => {
      mockDbInsertReturning.mockResolvedValueOnce([undefined]);

      await expect(mod.queueWebhook({
        id: 'wh-1', tenant_id: 't-1', url: 'https://x.com',
        event: 'test', payload: {},
      })).rejects.toThrow('Failed to queue webhook');
    });
  });

  describe('generateSignature', () => {
    it('generates a valid HMAC signature', async () => {
      const sig = await mod.generateSignature({
        id: 'd-1', webhook_id: 'wh-1', url: 'https://x.com',
        event_type: 'test', status: 'pending', payload: { msg: 'hello' },
      } as never);

      expect(sig).toMatch(/^sha256=/);
      expect(sig.length).toBeGreaterThan(40);
    });

    it('throws when WEBHOOK_SECRET is missing', async () => {
      process.env = { ...OLD_ENV };
      delete process.env.WEBHOOK_SECRET;

      await expect(mod.generateSignature({
        id: 'd-1', webhook_id: 'wh-1', url: 'https://x.com',
        event_type: 'test', status: 'pending', payload: {},
      } as never)).rejects.toThrow('WEBHOOK_SECRET');
    });

    it('throws when WEBHOOK_SECRET is default', async () => {
      process.env = { ...OLD_ENV, WEBHOOK_SECRET: 'webhook-secret-change-in-production' };

      await expect(mod.generateSignature({
        id: 'd-1', webhook_id: 'wh-1', url: 'https://x.com',
        event_type: 'test', status: 'pending', payload: {},
      } as never)).rejects.toThrow('WEBHOOK_SECRET');
    });
  });

  describe('processWebhookDelivery', () => {
    it('throws when delivery not found', async () => {
      mockDbFindFirst.mockResolvedValueOnce(null);

      await expect(mod.processWebhookDelivery('nonexistent'))
        .rejects.toThrow('not found');
    });

    it('throws when no URL is available', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'd-1', payload: {}, metadata: {}, status: 'pending',
      });

      await expect(mod.processWebhookDelivery('d-1'))
        .rejects.toThrow('No URL found');
    });

    it('updates to success on OK response', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'd-1', webhookId: 'wh-1', eventType: 'test',
        payload: {}, metadata: { url: 'https://x.com/hook', attempt: 0, max_retries: 3 },
        status: 'pending',
      });
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK', text: () => 'OK',
      });

      await mod.processWebhookDelivery('d-1');

      expect(mockDbUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success' })
      );
    });

    it('retries on failure with exponential backoff', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'd-1', webhookId: 'wh-1', eventType: 'test',
        payload: {}, metadata: { url: 'https://x.com/hook', attempt: 0, max_retries: 3 },
        status: 'pending',
      });
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      await mod.processWebhookDelivery('d-1');

      expect(mockDbUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      );
    });

    it('moves to DLQ after max retries exhausted', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        id: 'd-1', webhookId: 'wh-1', eventType: 'test',
        payload: {}, metadata: { url: 'https://x.com/hook', attempt: 3, max_retries: 3 },
        status: 'pending',
      });
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Final failure'));

      await mod.processWebhookDelivery('d-1');

      expect(mockDbUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      );
    });
  });

  describe('getWebhookStats', () => {
    it('returns zero stats when no results', async () => {
      mockDbSelectResolve.mockResolvedValue([{ count: 0 }]);

      const stats = await mod.getWebhookStats('wh-1');
      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.avgDeliveryTime).toBe(0);
    });

    it('returns stats with data', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ count: 10 }])
        .mockResolvedValueOnce([{ count: 7 }])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ avg_ms: 450 }]);

      const stats = await mod.getWebhookStats('wh-1');
      expect(stats.total).toBe(10);
      expect(stats.success).toBe(7);
      expect(stats.failed).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.avgDeliveryTime).toBe(450);
    });
  });
});

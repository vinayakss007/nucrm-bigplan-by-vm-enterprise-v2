import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => []),
          })),
          limit: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'delivery-1' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  integrations: {
    id: 'id',
    tenantId: 'tenant_id',
    type: 'type',
    isActive: 'is_active',
    config: 'config',
    name: 'name',
    lastUsedAt: 'last_used_at',
  },
}));

vi.mock('@/drizzle/schema/support', () => ({
  webhookQueue: {
    id: 'id',
    webhookId: 'webhook_id',
    url: 'url',
    method: 'method',
    headers: 'headers',
    payload: 'payload',
    status: 'status',
    attempt: 'attempt',
    responseStatus: 'response_status',
    deliveredAt: 'delivered_at',
    nextRetryAt: 'next_retry_at',
    createdAt: 'created_at',
    errorMessage: 'error_message',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  lte: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
  asc: vi.fn(),
}));

import { db } from '@/drizzle/db';
import { logger } from '@/lib/logger';

describe('webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('getRetryDelay', () => {
    it('returns 5 minutes for attempt 1', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(1)).toBe(300000);
    });

    it('returns 30 minutes for attempt 2', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(2)).toBe(1800000);
    });

    it('returns 2 hours for attempt 3', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(3)).toBe(7200000);
    });

    it('returns 12 hours for attempt 4', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(4)).toBe(43200000);
    });

    it('returns -1 (dead letter) for attempt 5+', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(5)).toBe(-1);
      expect(getRetryDelay(10)).toBe(-1);
    });

    it('returns first delay for attempt 0 or negative', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(0)).toBe(300000);
      expect(getRetryDelay(-1)).toBe(300000);
    });
  });

  describe('fireWebhooks', () => {
    it('returns early when no webhooks configured', async () => {
      const whereFn = vi.fn().mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', { id: '123' });

      expect(db.select).toHaveBeenCalled();
    });

    it('sends webhook POST to configured URL', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'Test Hook', config: { url: 'https://example.com/webhook', events: [] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', { id: '123' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({ method: 'POST' }),
      );
      const fetchArgs = mockFetch.mock.calls[0][1];
      expect(fetchArgs.headers['Content-Type']).toBe('application/json');
      expect(fetchArgs.headers['X-NuCRM-Event']).toBe('contact.created');
      expect(fetchArgs.headers['X-NuCRM-Delivery']).toBeDefined();

      vi.unstubAllGlobals();
    });

    it('adds HMAC signature when secret is configured', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'Signed Hook', config: { url: 'https://example.com/hook', secret: 'my-secret', events: [] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'deal.won', { id: '456' });

      const fetchArgs = mockFetch.mock.calls[0][1];
      expect(fetchArgs.headers['X-NuCRM-Signature']).toMatch(/^sha256=/);

      vi.unstubAllGlobals();
    });

    it('skips hooks not subscribed to the event', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'Filtered Hook', config: { url: 'https://example.com/hook', events: ['contact.created'] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'deal.updated', { id: '789' });

      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('updates delivery to success on 2xx response', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'OK Hook', config: { url: 'https://example.com/ok', events: [] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', responseStatus: 200 }),
      );

      vi.unstubAllGlobals();
    });

    it('updates delivery to failed on error response', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'Fail Hook', config: { url: 'https://example.com/fail', events: [] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Server Error'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', responseStatus: 500 }),
      );

      vi.unstubAllGlobals();
    });

    it('logs warning when individual hook delivery throws', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'Broken Hook', config: { url: 'https://example.com/broken', events: [] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', mockFetch);

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'delivery-1' }]),
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Broken Hook delivery error'),
      );

      vi.unstubAllGlobals();
    });

    it('skips hooks with missing URL in config', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { id: 'hook-1', name: 'No URL Hook', config: { events: [] }, isActive: true, type: 'webhook', tenantId: 'tenant-1', lastUsedAt: null },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('logs error and continues when top-level query fails', async () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('retryFailedWebhooks', () => {
    it('returns 0 when no failed webhooks to retry', async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: limitFn,
            })),
          })),
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      const result = await retryFailedWebhooks();

      expect(result).toBe(0);
    });

    it('retries failed webhook and marks success', async () => {
      const limitFn = vi.fn().mockResolvedValue([
        {
          id: 'delivery-1',
          webhookId: 'hook-1',
          url: 'https://example.com/retry',
          headers: { 'X-Custom': 'value' },
          payload: { event: 'contact.created', data: {} },
          attempt: 1,
          status: 'failed',
          createdAt: new Date(),
        },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: limitFn,
            })),
          })),
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', mockFetch);

      const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      const result = await retryFailedWebhooks();

      expect(result).toBe(1);
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', responseStatus: 200 }),
      );

      vi.unstubAllGlobals();
    });

    it('moves to dead_letter after max retries', async () => {
      const limitFn = vi.fn().mockResolvedValue([
        {
          id: 'delivery-5',
          webhookId: 'hook-1',
          url: 'https://example.com/retry',
          headers: {},
          payload: { event: 'deal.created', data: {} },
          attempt: 4,
          status: 'failed',
          createdAt: new Date(),
        },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: limitFn,
            })),
          })),
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      vi.stubGlobal('fetch', mockFetch);

      const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      await retryFailedWebhooks();

      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'dead_letter' }),
      );

      vi.unstubAllGlobals();
    });

    it('handles fetch error by incrementing attempt', async () => {
      const limitFn = vi.fn().mockResolvedValue([
        {
          id: 'delivery-2',
          webhookId: 'hook-1',
          url: 'https://example.com/retry',
          headers: {},
          payload: { event: 'task.created', data: {} },
          attempt: 1,
          status: 'failed',
          createdAt: new Date(),
        },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: limitFn,
            })),
          })),
        })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const mockFetch = vi.fn().mockRejectedValue(new Error('Timeout'));
      vi.stubGlobal('fetch', mockFetch);

      const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      const result = await retryFailedWebhooks();

      expect(result).toBe(0);
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2, errorMessage: 'Timeout' }),
      );

      vi.unstubAllGlobals();
    });

    it('returns 0 when query fails', async () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error('Query failed');
      });

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      const result = await retryFailedWebhooks();

      expect(result).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

/**
 * Regression tests for the repaired outbound webhook delivery pipeline.
 *
 * Bugs locked down here:
 *  1. webhook_queue rows were inserted without a tenant_id (column did not even
 *     exist on a DB built from migrations) -> insert must now carry tenantId.
 *  2. Successful deliveries were written as status 'success' while the rest of
 *     the codebase reads/writes 'delivered' -> must now be 'delivered'.
 *  3. Failed deliveries never populated failed_at -> must now be set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles stand in for Drizzle's builder chain types
type Any = any;

const mockTxSet = vi.hoisted(() => vi.fn(() => ({ where: vi.fn() })));
const mockTxUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockTxSet })));
const mockInsertValues = vi.hoisted(() =>
  vi.fn(() => ({ returning: vi.fn(() => [{ id: 'delivery-1' }]) })),
);

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(() => []) })),
          limit: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    transaction: vi.fn((cb: (tx: Any) => Promise<Any>) =>
      cb({
        update: mockTxUpdate,
        insert: vi.fn(() => ({ values: mockInsertValues })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => []) })) })),
        })),
      }),
    ),
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
    tenantId: 'tenant_id',
    webhookId: 'webhook_id',
    url: 'url',
    method: 'method',
    headers: 'headers',
    payload: 'payload',
    status: 'status',
    attempt: 'attempt',
    responseStatus: 'response_status',
    responseBody: 'response_body',
    deliveredAt: 'delivered_at',
    failedAt: 'failed_at',
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

/** Make db.select() resolve to the given list of webhook integrations. */
function stubHooks(hooks: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(hooks) })),
  } as Any);
}

function hook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hook-1',
    name: 'Test Hook',
    type: 'webhook',
    isActive: true,
    tenantId: 'tenant-1',
    lastUsedAt: null,
    config: { url: 'https://example.com/hook', events: [] },
    ...overrides,
  };
}

function okResponse(status = 200) {
  return { ok: true, status, text: vi.fn().mockResolvedValue('') };
}

function errResponse(status = 500, body = 'Server Error') {
  return { ok: false, status, text: vi.fn().mockResolvedValue(body) };
}

describe('webhook delivery fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockTxSet.mockReturnValue({ where: vi.fn() });
    mockTxUpdate.mockReturnValue({ set: mockTxSet });
    mockInsertValues.mockReturnValue({ returning: vi.fn(() => [{ id: 'delivery-1' }]) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getRetryDelay', () => {
    it('returns 5min / 30min / 2hr / 12hr / 24hr for attempts 1-5', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(1)).toBe(5 * 60 * 1000);
      expect(getRetryDelay(2)).toBe(30 * 60 * 1000);
      expect(getRetryDelay(3)).toBe(2 * 60 * 60 * 1000);
      expect(getRetryDelay(4)).toBe(12 * 60 * 60 * 1000);
      expect(getRetryDelay(5)).toBe(24 * 60 * 60 * 1000);
    });

    it('returns -1 (dead letter) for attempt 6 and beyond', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(6)).toBe(-1);
      expect(getRetryDelay(99)).toBe(-1);
    });

    it('clamps attempt 0 and negative attempts to the first delay', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(0)).toBe(5 * 60 * 1000);
      expect(getRetryDelay(-3)).toBe(5 * 60 * 1000);
    });
  });

  describe('fireWebhooks - hook selection', () => {
    it('returns early without inserting when the tenant has no active webhook integrations', async () => {
      stubHooks([]);
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', { id: '1' });

      expect(db.insert).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips a hook whose config has no url', async () => {
      stubHooks([hook({ config: { events: [] } })]);
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(db.insert).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips a hook whose non-empty config.events does not include the fired event', async () => {
      stubHooks([
        hook({ config: { url: 'https://example.com/hook', events: ['contact.created'] } }),
      ]);
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'deal.won', {});

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('delivers to a hook whose config.events is empty (empty means subscribe-to-all)', async () => {
      stubHooks([hook({ config: { url: 'https://example.com/all', events: [] } })]);
      const mockFetch = vi.fn().mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'invoice.paid', {});

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/all',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('fireWebhooks - queue row', () => {
    it('includes tenantId in the webhook_queue insert', async () => {
      stubHooks([hook()]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-42', 'contact.created', {});

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-42',
          webhookId: 'hook-1',
          url: 'https://example.com/hook',
          status: 'pending',
        }),
      );
    });

    it('logs an error (not a warning) and continues when the queue insert fails', async () => {
      stubHooks([hook()]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
      mockInsertValues.mockReturnValue({
        returning: vi.fn(() => {
          throw new Error('insert exploded');
        }),
      } as Any);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('enqueue'),
        expect.objectContaining({ hookId: 'hook-1', event: 'contact.created' }),
      );
    });
  });

  describe('fireWebhooks - delivery status', () => {
    it("marks the row 'delivered' (not 'success') on a 2xx response", async () => {
      stubHooks([hook()]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(201)));

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'delivered', responseStatus: 201 }),
      );
      const statuses = mockTxSet.mock.calls.map((c) => (c[0] as Any)?.status);
      expect(statuses).not.toContain('success');
    });

    it("marks the row 'failed', sets nextRetryAt and failedAt on a non-2xx response", async () => {
      stubHooks([hook()]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(503)));

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          responseStatus: 503,
          nextRetryAt: expect.any(Date),
          failedAt: expect.any(Date),
        }),
      );
    });
  });

  describe('fireWebhooks - signing', () => {
    it('sets an HMAC X-NuCRM-Signature header when config.secret is present', async () => {
      stubHooks([
        hook({ config: { url: 'https://example.com/hook', events: [], secret: 's3cret' } }),
      ]);
      const mockFetch = vi.fn().mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'deal.won', { id: 'd-1' });

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['X-NuCRM-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('omits X-NuCRM-Signature when no secret is configured', async () => {
      stubHooks([hook()]);
      const mockFetch = vi.fn().mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'deal.won', {});

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['X-NuCRM-Signature']).toBeUndefined();
      expect(headers['X-NuCRM-Event']).toBe('deal.won');
    });
  });

  describe('fireWebhooks - resilience', () => {
    it('one failing hook does not prevent delivery to a second hook', async () => {
      stubHooks([
        hook({ id: 'hook-bad', name: 'Bad', config: { url: 'https://bad.example/hook', events: [] } }),
        hook({ id: 'hook-good', name: 'Good', config: { url: 'https://good.example/hook', events: [] } }),
      ]);
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(okResponse());
      vi.stubGlobal('fetch', mockFetch);

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', {});

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1]![0]).toBe('https://good.example/hook');
      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'delivered' }),
      );
    });
  });

  describe('retryFailedWebhooks', () => {
    it("marks a successful retry as 'delivered'", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 'delivery-9',
                  webhookId: 'hook-1',
                  url: 'https://example.com/retry',
                  headers: {},
                  payload: { event: 'contact.created', data: {} },
                  attempt: 1,
                  status: 'failed',
                  createdAt: new Date(),
                },
              ]),
            })),
          })),
        })),
      } as Any);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const setFn = vi.fn(() => ({ where: vi.fn() }));
      vi.mocked(db.update).mockReturnValue({ set: setFn } as Any);

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      const retried = await retryFailedWebhooks();

      expect(retried).toBe(1);
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'delivered', responseStatus: 200 }),
      );
    });
  });
});

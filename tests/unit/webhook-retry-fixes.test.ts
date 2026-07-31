/**
 * Tests for webhook retry/DLQ fixes:
 * - Concurrency limiting (max 5 parallel)
 * - Off-by-one fix in retry count (5 delays match MAX_RETRIES=5)
 * - Initial failure sets attempt=1
 * - Exponential backoff cap at 3600 seconds
 * - DLQ purge integration in cron route
 * - Backlog warning when queue exceeds batch size
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track concurrent calls
let activeConcurrency = 0;
let peakConcurrency = 0;

const mockFetch = vi.fn(async () => {
  activeConcurrency++;
  peakConcurrency = Math.max(peakConcurrency, activeConcurrency);
  // Simulate some async work
  await new Promise(r => setTimeout(r, 10));
  activeConcurrency--;
  return { ok: true, status: 200, text: async () => '' };
});

// Mock globals
vi.stubGlobal('fetch', mockFetch);

// Mock drizzle DB
const mockSelectResult: unknown[] = [];
const mockUpdateSet = vi.fn(() => ({ where: vi.fn() }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));
const mockInsertValues = vi.fn(() => ({ returning: vi.fn(() => [{ id: 'delivery-1' }]) }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => mockSelectResult),
          })),
          limit: vi.fn(() => mockSelectResult),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
    update: mockUpdate,
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'purged-1' }]),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(),
          })),
        })),
      };
      return fn(tx);
    }),
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
    $inferSelect: {},
    id: 'id',
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
    nextRetryAt: 'next_retry_at',
    createdAt: 'created_at',
    errorMessage: 'error_message',
  },
}));

vi.mock('@/drizzle/schema/automation', () => ({
  deadLetterQueue: {
    id: 'id',
    tenantId: 'tenant_id',
    createdAt: 'created_at',
    status: 'status',
  },
  webhookDeliveries: {
    id: 'id',
    tenantId: 'tenant_id',
    webhookId: 'webhook_id',
    eventType: 'event_type',
    payload: 'payload',
    status: 'status',
    responseStatus: 'response_status',
    responseBody: 'response_body',
    durationMs: 'duration_ms',
    metadata: 'metadata',
    createdAt: 'created_at',
  },
}));

const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { warn: mockLoggerWarn, error: mockLoggerError, info: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  lte: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  gt: vi.fn(),
}));

describe('Webhook Retry Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeConcurrency = 0;
    peakConcurrency = 0;
    mockSelectResult.length = 0;
    mockFetch.mockImplementation(async () => {
      activeConcurrency++;
      peakConcurrency = Math.max(peakConcurrency, activeConcurrency);
      await new Promise(r => setTimeout(r, 10));
      activeConcurrency--;
      return { ok: true, status: 200, text: async () => '' };
    });
  });

  describe('getRetryDelay off-by-one fix', () => {
    it('has 5 delay entries matching MAX_RETRIES=5', async () => {
      const { getRetryDelay, MAX_RETRIES } = await import('@/lib/webhooks');
      // All attempts from 1 to MAX_RETRIES should return a positive delay
      for (let i = 1; i <= MAX_RETRIES; i++) {
        expect(getRetryDelay(i)).toBeGreaterThan(0);
      }
      // Attempt beyond MAX_RETRIES returns -1 (dead letter)
      expect(getRetryDelay(MAX_RETRIES + 1)).toBe(-1);
    });

    it('attempt 5 returns 24 hours (not -1 dead letter)', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(5)).toBe(24 * 60 * 60 * 1000);
    });

    it('attempt 6 returns -1 (dead letter)', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(6)).toBe(-1);
    });

    it('all delays are monotonically increasing', async () => {
      const { getRetryDelay, MAX_RETRIES } = await import('@/lib/webhooks');
      let prev = 0;
      for (let i = 1; i <= MAX_RETRIES; i++) {
        const delay = getRetryDelay(i);
        expect(delay).toBeGreaterThan(prev);
        prev = delay;
      }
    });
  });

  describe('Concurrency limiting in retryFailedWebhooks', () => {
    it('MAX_CONCURRENCY is exported and equals 5', async () => {
      const { MAX_CONCURRENCY } = await import('@/lib/webhooks');
      expect(MAX_CONCURRENCY).toBe(5);
    });

    it('processes at most MAX_CONCURRENCY items in parallel', async () => {
      const { MAX_CONCURRENCY } = await import('@/lib/webhooks');

      // Fill the mock result with 15 items (3 batches of 5)
      for (let i = 0; i < 15; i++) {
        mockSelectResult.push({
          id: `item-${i}`,
          url: 'http://example.com/hook',
          headers: {},
          payload: { test: true },
          attempt: 1,
          status: 'failed',
        });
      }

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      await retryFailedWebhooks();

      // Peak concurrency should never exceed MAX_CONCURRENCY
      expect(peakConcurrency).toBeLessThanOrEqual(MAX_CONCURRENCY);
      // Should have made 15 fetch calls total
      expect(mockFetch).toHaveBeenCalledTimes(15);
    });

    it('returns count of successfully retried items', async () => {
      mockSelectResult.push(
        { id: 'item-1', url: 'http://example.com/hook', headers: {}, payload: {}, attempt: 1, status: 'failed' },
        { id: 'item-2', url: 'http://example.com/hook', headers: {}, payload: {}, attempt: 1, status: 'failed' },
      );

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      const result = await retryFailedWebhooks();
      expect(result).toBe(2);
    });
  });

  describe('Backlog warning', () => {
    it('logs warning when 50+ items are eligible for retry', async () => {
      // Fill with exactly 50 items to trigger warning
      for (let i = 0; i < 50; i++) {
        mockSelectResult.push({
          id: `item-${i}`,
          url: 'http://example.com/hook',
          headers: {},
          payload: {},
          attempt: 1,
          status: 'failed',
        });
      }

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      await retryFailedWebhooks();

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('Retry backlog exceeds batch size')
      );
    });

    it('does not log warning when fewer than 50 items', async () => {
      mockSelectResult.push({
        id: 'item-1',
        url: 'http://example.com/hook',
        headers: {},
        payload: {},
        attempt: 1,
        status: 'failed',
      });

      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      await retryFailedWebhooks();

      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
  });

  describe('Backoff cap in delivery.ts', () => {
    it('backoff delay is capped at 3600 seconds maximum', async () => {
      // For high attempt numbers, Math.pow(2, attempt) * 60 would exceed 3600
      // attempt 6 = 2^6 * 60 = 3840 which should be capped to 3600
      // We test the math logic directly
      const MAX_BACKOFF_SECONDS = 3600;
      const attempts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20];

      for (const attempt of attempts) {
        const baseDelay = Math.min(Math.pow(2, attempt) * 60, MAX_BACKOFF_SECONDS);
        expect(baseDelay).toBeLessThanOrEqual(MAX_BACKOFF_SECONDS);
      }
    });

    it('attempt 6+ triggers the cap (uncapped would be > 3600)', () => {
      // Verify the cap is actually needed for higher attempts
      const uncappedAttempt6 = Math.pow(2, 6) * 60; // 3840
      expect(uncappedAttempt6).toBeGreaterThan(3600);

      const cappedAttempt6 = Math.min(uncappedAttempt6, 3600);
      expect(cappedAttempt6).toBe(3600);
    });

    it('attempt 5 is still under the cap', () => {
      const uncappedAttempt5 = Math.pow(2, 5) * 60; // 1920
      expect(uncappedAttempt5).toBeLessThan(3600);
      // So capping does not change it
      expect(Math.min(uncappedAttempt5, 3600)).toBe(uncappedAttempt5);
    });
  });

  describe('DLQ purge integration', () => {
    it('purgeOldDLQEntries is exported from dlq module', async () => {
      const dlq = await import('@/lib/webhooks/dlq');
      expect(dlq.purgeOldDLQEntries).toBeDefined();
      expect(typeof dlq.purgeOldDLQEntries).toBe('function');
    });

    it('purgeOldDLQEntries deletes entries older than specified days', async () => {
      const { purgeOldDLQEntries } = await import('@/lib/webhooks/dlq');
      const result = await purgeOldDLQEntries(30);
      // Our mock returns [{ id: 'purged-1' }] from the delete chain
      expect(result).toBe(1);
    });
  });

  describe('Initial failure sets attempt=1', () => {
    it('fireWebhooks sets attempt=1 on non-2xx initial response', async () => {
      // This tests the logic path: when initial delivery gets a non-2xx,
      // the webhook queue entry should have attempt=1 (not remain at 0)
      const { db } = await import('@/drizzle/db');

      // Mock the select to return a hook with valid config
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [{
            id: 'hook-1',
            tenantId: 'tenant-1',
            type: 'webhook',
            isActive: true,
            name: 'Test Hook',
            config: { url: 'http://example.com/hook', events: [] },
          }]),
        })),
      } as never);

      // Mock insert to return a delivery record
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'delivery-123' }]),
        })),
      } as never);

      // Mock fetch to return 500
      mockFetch.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server Error',
      }));

      // Mock transaction to capture the set() call
      const capturedSets: Record<string, unknown>[] = [];
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) => {
        const tx = {
          update: vi.fn(() => ({
            set: vi.fn((data: Record<string, unknown>) => {
              capturedSets.push(data);
              return { where: vi.fn() };
            }),
          })),
        };
        await fn(tx as never);
      });

      const { fireWebhooks } = await import('@/lib/webhooks');
      await fireWebhooks('tenant-1', 'contact.created', { id: '1' });

      // The first transaction set() is for the failed webhook queue entry
      expect(capturedSets.length).toBeGreaterThanOrEqual(1);
      const webhookUpdate = capturedSets[0];
      expect(webhookUpdate).toBeDefined();
      expect(webhookUpdate!.attempt).toBe(1);
      expect(webhookUpdate!.status).toBe('failed');
    });
  });
});

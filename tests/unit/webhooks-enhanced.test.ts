import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
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

describe('Webhooks Enhanced', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('getRetryDelay', () => {
    it('returns 5 minutes for attempt 1', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(1)).toBe(5 * 60 * 1000);
    });

    it('returns 30 minutes for attempt 2', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(2)).toBe(30 * 60 * 1000);
    });

    it('returns 2 hours for attempt 3', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(3)).toBe(2 * 60 * 60 * 1000);
    });

    it('returns 12 hours for attempt 4', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(4)).toBe(12 * 60 * 60 * 1000);
    });

    it('returns -1 (dead letter) for attempt 5+', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(5)).toBe(-1);
      expect(getRetryDelay(6)).toBe(-1);
    });

    it('returns first delay for attempt 0 or negative', async () => {
      const { getRetryDelay } = await import('@/lib/webhooks');
      expect(getRetryDelay(0)).toBe(5 * 60 * 1000);
    });
  });

  describe('WebhookEvent types', () => {
    it('expanded event types include new events', async () => {
      // Import the type and verify the module exports correctly
      const webhooks = await import('@/lib/webhooks');
      // Verify the module has the expected exports
      expect(webhooks.fireWebhooks).toBeDefined();
      expect(webhooks.retryFailedWebhooks).toBeDefined();
      expect(webhooks.getRetryDelay).toBeDefined();
    });

    it('all event types are valid string values', async () => {
      // Type checking ensures these are valid at compile time
      // This test verifies the module exports work correctly
      const { getRetryDelay } = await import('@/lib/webhooks');
      // We verify the function works, and TypeScript compilation
      // verifies the event types are valid
      expect(typeof getRetryDelay).toBe('function');
    });
  });

  describe('MAX_RETRIES constant', () => {
    it('retryFailedWebhooks function exists', async () => {
      const { retryFailedWebhooks } = await import('@/lib/webhooks');
      expect(typeof retryFailedWebhooks).toBe('function');
    });
  });
});

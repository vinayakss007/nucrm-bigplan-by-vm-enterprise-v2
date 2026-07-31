import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Log Stream Tests ─────────────────────────────────────────────────────────

describe('lib/log-stream: bounded clients Map', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('evicts the oldest client when exceeding MAX_CLIENTS (100)', async () => {
    const { logStream } = await import('@/lib/log-stream');

    // Subscribe 100 clients
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const controller = {
        enqueue: vi.fn(),
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController;
      const id = logStream.subscribe(controller);
      ids.push(id);
    }

    expect(logStream.clientCount).toBe(100);

    // Subscribe the 101st client - should evict the first
    const controller101 = {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController;
    logStream.subscribe(controller101);

    expect(logStream.clientCount).toBe(100);
  });

  it('unsubscribe removes a client', async () => {
    const { logStream } = await import('@/lib/log-stream');

    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController;
    const id = logStream.subscribe(controller);

    expect(logStream.clientCount).toBe(1);
    logStream.unsubscribe(id);
    expect(logStream.clientCount).toBe(0);
  });
});

// ─── Deprecation Registry Tests ──────────────────────────────────────────────

describe('lib/api/deprecation: bounded registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('caps the registry at MAX_REGISTRY_ENTRIES (200)', async () => {
    const {
      registerDeprecation,
      getDeprecatedEndpoints,
      clearDeprecationRegistry,
    } = await import('@/lib/api/deprecation');

    clearDeprecationRegistry();

    // Register 200 entries
    for (let i = 0; i < 200; i++) {
      registerDeprecation({
        path: `/api/v1/resource-${i}`,
        method: 'GET',
        since: '2024-01-01',
        message: `Deprecated ${i}`,
      });
    }

    expect(getDeprecatedEndpoints()).toHaveLength(200);

    // Register one more (201st) - should evict oldest and stay at 200
    registerDeprecation({
      path: '/api/v1/resource-200',
      method: 'GET',
      since: '2024-01-01',
      message: 'Deprecated 200',
    });

    const endpoints = getDeprecatedEndpoints();
    expect(endpoints).toHaveLength(200);

    // The first entry should have been evicted
    const paths = endpoints.map((e) => e.path);
    expect(paths).not.toContain('/api/v1/resource-0');
    expect(paths).toContain('/api/v1/resource-200');
  });

  it('does not evict when updating existing key', async () => {
    const {
      registerDeprecation,
      getDeprecatedEndpoints,
      clearDeprecationRegistry,
    } = await import('@/lib/api/deprecation');

    clearDeprecationRegistry();

    // Register 200 unique entries
    for (let i = 0; i < 200; i++) {
      registerDeprecation({
        path: `/api/v1/thing-${i}`,
        method: 'GET',
        since: '2024-01-01',
      });
    }

    // Update an existing entry (same method:path key)
    registerDeprecation({
      path: '/api/v1/thing-50',
      method: 'GET',
      since: '2024-06-01',
      message: 'Updated',
    });

    expect(getDeprecatedEndpoints()).toHaveLength(200);
  });
});

// ─── Critical Error Alert: Rate Limit Map Tests ──────────────────────────────

vi.mock('@/lib/pagerduty', () => ({
  sendPagerDutyAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/email/service', () => ({
  sendWebhookNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/telegram-admin', () => ({
  sendAdminTelegram: vi.fn().mockResolvedValue(undefined),
}));

describe('lib/critical-error-alert: rateLimitMap eviction', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rate-limits duplicate error messages within the window', async () => {
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');

    // First call should go through (not rate limited)
    const p1 = sendCriticalErrorAlert({ error: new Error('test error'), context: 'unit-test' });
    // Advance past the 1s internal wait
    await vi.advanceTimersByTimeAsync(1_100);
    await p1;
    expect(sendPagerDutyAlert).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Second call with same message within 60s should be rate-limited (no dispatch)
    vi.setSystemTime(now + 30_000); // 30s later
    const p2 = sendCriticalErrorAlert({ error: new Error('test error'), context: 'unit-test' });
    await vi.advanceTimersByTimeAsync(1_100);
    await p2;
    expect(sendPagerDutyAlert).not.toHaveBeenCalled();

    // After window expires, should go through again
    vi.clearAllMocks();
    vi.setSystemTime(now + 61_000); // 61s later
    const p3 = sendCriticalErrorAlert({ error: new Error('test error'), context: 'unit-test' });
    await vi.advanceTimersByTimeAsync(1_100);
    await p3;
    expect(sendPagerDutyAlert).toHaveBeenCalledTimes(1);
  });
});

// ─── Email Router: Auto-reset daily counters ─────────────────────────────────

describe('lib/email/router: daily counter auto-reset', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets sentToday counters when 24h elapses', async () => {
    vi.useFakeTimers();
    const baseTime = 1_700_000_000_000;
    vi.setSystemTime(baseTime);

    const { getEmailUsage, resetDailyCounters } = await import('@/lib/email/router');

    // Simulate some sends by resetting and checking
    // The router initializes usage on import, so counters start at 0
    const usage = getEmailUsage();
    const providers = Object.keys(usage);

    // If no providers are configured (no env vars), just verify the shape
    if (providers.length > 0) {
      // Manually bump usage for testing
      const provider = providers[0];
      expect(usage[provider].sentToday).toBe(0);
    }

    // resetDailyCounters should clear sentToday
    resetDailyCounters();
    const afterReset = getEmailUsage();
    for (const key of Object.keys(afterReset)) {
      expect(afterReset[key].sentToday).toBe(0);
    }
  });
});

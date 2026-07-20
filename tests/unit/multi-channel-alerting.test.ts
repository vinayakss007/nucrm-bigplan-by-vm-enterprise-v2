import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('lib/pagerduty', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PAGERDUTY_ROUTING_KEY;
    delete process.env.PAGERDUTY_ENABLED;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('sendPagerDutyAlert', () => {
    it('returns false when PAGERDUTY_ROUTING_KEY not set', async () => {
      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await sendPagerDutyAlert({ summary: 'test', severity: 'critical' });
      expect(result).toBe(false);
    });

    it('returns false when PAGERDUTY_ENABLED=false override', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      process.env.PAGERDUTY_ENABLED = 'false';
      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await sendPagerDutyAlert({ summary: 'test', severity: 'critical' });
      expect(result).toBe(false);
    });

    it('sends POST to PagerDuty Events API v2 when configured', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await sendPagerDutyAlert({
        summary: 'DB connection pool exhausted',
        severity: 'critical',
        source: 'nucrm-production',
        component: 'database',
        group: 'db-errors',
        details: { connections: 20, max: 20 },
      });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://events.pagerduty.com/v2/enqueue');
      const body = JSON.parse(opts.body as string);
      expect(body.routing_key).toBe('a'.repeat(32));
      expect(body.event_action).toBe('trigger');
      expect(body.payload.severity).toBe('critical');
      expect(body.payload.source).toBe('nucrm-production');
      expect(body.payload.component).toBe('database');
      expect(body.payload.custom_details.connections).toBe(20);
      expect(body.payload.timestamp).toBeTruthy();

      vi.unstubAllGlobals();
    });

    it('returns false when PagerDuty API returns non-200', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') }));

      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await sendPagerDutyAlert({ summary: 'test', severity: 'error' });
      expect(result).toBe(false);

      vi.unstubAllGlobals();
    });

    it('returns false on network error (never throws)', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await sendPagerDutyAlert({ summary: 'test', severity: 'warning' });
      expect(result).toBe(false);

      vi.unstubAllGlobals();
    });

    it('uses dedup key to merge related alerts', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      await sendPagerDutyAlert({
        summary: 'Rate limit hit',
        severity: 'warning',
        dedupKey: 'rate-limit-tenant-abc',
      });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.dedup_key).toBe('rate-limit-tenant-abc');

      vi.unstubAllGlobals();
    });

    it('auto-generates dedup key from summary', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      await sendPagerDutyAlert({ summary: 'DB connection pool exhausted!', severity: 'error' });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.dedup_key).toBe('db-connection-pool-exhausted-');
      expect(body.dedup_key.length).toBeLessThanOrEqual(64);

      vi.unstubAllGlobals();
    });

    it('maps fatal-level to critical severity in PagerDuty', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
      await sendPagerDutyAlert({ summary: 'test', severity: 'critical' });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.payload.severity).toBe('critical');

      vi.unstubAllGlobals();
    });
  });

  describe('resolvePagerDutyAlert', () => {
    it('returns false when not configured', async () => {
      const { resolvePagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await resolvePagerDutyAlert('dedup-key-123');
      expect(result).toBe(false);
    });

    it('sends acknowledge event to PagerDuty', async () => {
      process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const { resolvePagerDutyAlert } = await import('@/lib/pagerduty');
      const result = await resolvePagerDutyAlert('dedup-key-123');
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.event_action).toBe('acknowledge');
      expect(body.dedup_key).toBe('dedup-key-123');

      vi.unstubAllGlobals();
    });
  });
});

describe('lib/critical-error-alert - multi-channel dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CRITICAL_ERROR_WEBHOOK_URL;
    delete process.env.PAGERDUTY_ROUTING_KEY;
    delete process.env.PAGERDUTY_ENABLED;
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does nothing when no channels configured', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    await sendCriticalErrorAlert({ error: new Error('test') });

    // Should not attempt any fetch since no webhook configured
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('dispatches to generic webhook when CRITICAL_ERROR_WEBHOOK_URL set', async () => {
    process.env.CRITICAL_ERROR_WEBHOOK_URL = 'https://hooks.example.com/alerts';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    await sendCriticalErrorAlert({
      error: new Error('Database pool exhausted'),
      level: 'fatal',
      context: 'database',
    });

    // Allow in-flight fetches
    await new Promise((r) => setTimeout(r, 200));

    // Generic webhook should be called
    const webhookCall = mockFetch.mock.calls.find(
      (c: [string, RequestInit]) => c[0] === 'https://hooks.example.com/alerts',
    );
    expect(webhookCall).toBeTruthy();
    const body = JSON.parse(webhookCall![1].body as string);
    expect(body.event).toBe('critical_error');
    expect(body.level).toBe('fatal');
    expect(body.message).toBe('Database pool exhausted');
    expect(body.context).toBe('database');
    expect(body.environment).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it('sends to PagerDuty when PAGERDUTY_ROUTING_KEY set', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'a'.repeat(32);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    await sendCriticalErrorAlert({
      error: new Error('Disk full'),
      level: 'fatal',
      context: 'storage',
    });

    // Allow in-flight + timeout
    await new Promise((r) => setTimeout(r, 200));

    // PagerDuty should be called
    const pdCall = mockFetch.mock.calls.find(
      (c: [string, RequestInit]) => c[0] === 'https://events.pagerduty.com/v2/enqueue',
    );
    expect(pdCall).toBeTruthy();
    const body = JSON.parse(pdCall![1].body as string);
    expect(body.payload.severity).toBe('critical');
    expect(body.payload.summary).toContain('Disk full');

    vi.unstubAllGlobals();
  });

  it('rate-limits duplicate errors within 60s window', async () => {
    process.env.CRITICAL_ERROR_WEBHOOK_URL = 'https://hooks.example.com/alerts';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');

    // First call — should go through
    await sendCriticalErrorAlert({ error: new Error('Same error'), context: 'test' });
    await new Promise((r) => setTimeout(r, 200));
    expect(mockFetch).toHaveBeenCalled();
    const firstCount = mockFetch.mock.calls.length;

    // Second call — should be rate-limited
    await sendCriticalErrorAlert({ error: new Error('Same error'), context: 'test' });
    await new Promise((r) => setTimeout(r, 200));
    expect(mockFetch.mock.calls.length).toBe(firstCount); // no new calls

    vi.unstubAllGlobals();
  });

  it('truncates stack traces to 10 lines', async () => {
    process.env.CRITICAL_ERROR_WEBHOOK_URL = 'https://hooks.example.com/alerts';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const error = new Error('big error');
    error.stack = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');

    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    await sendCriticalErrorAlert({ error, context: 'test' });
    await new Promise((r) => setTimeout(r, 200));

    const webhookCall = mockFetch.mock.calls.find(
      (c: [string, RequestInit]) => c[0] === 'https://hooks.example.com/alerts',
    );
    const body = JSON.parse(webhookCall![1].body as string);
    expect(body.stack_trace.split('\n')).toHaveLength(11); // 10 lines + truncation line
    expect(body.stack_trace).toContain('truncated');

    vi.unstubAllGlobals();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('pagerduty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env['PAGERDUTY_ENABLED'];
  });

  afterAll(() => {
    delete process.env['PAGERDUTY_ROUTING_KEY'];
    delete process.env['PAGERDUTY_ENABLED'];
  });

  it('sends alert with valid routing key', async () => {
    process.env['PAGERDUTY_ROUTING_KEY'] = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ status: 'success' }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const result = await sendPagerDutyAlert({ summary: 'Test alert', severity: 'critical' });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://events.pagerduty.com/v2/enqueue', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    globalThis.fetch = originalFetch;
  });

  it('returns false when disabled', async () => {
    delete process.env['PAGERDUTY_ROUTING_KEY'];
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const result = await sendPagerDutyAlert({ summary: 'Test', severity: 'warning' });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  it('returns false on fetch error', async () => {
    process.env['PAGERDUTY_ROUTING_KEY'] = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const result = await sendPagerDutyAlert({ summary: 'Test', severity: 'error' });
    expect(result).toBe(false);
    globalThis.fetch = originalFetch;
  });

  it('respects PAGERDUTY_ENABLED=false override', async () => {
    process.env['PAGERDUTY_ROUTING_KEY'] = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    process.env['PAGERDUTY_ENABLED'] = 'false';
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const result = await sendPagerDutyAlert({ summary: 'Test', severity: 'info' });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  it('includes optional fields in payload', async () => {
    process.env['PAGERDUTY_ROUTING_KEY'] = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    let requestBody!: { payload: { summary: string; source: string; custom_details: unknown } };
    const mockFetch = vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
      requestBody = JSON.parse(opts.body as string);
      return { ok: true, json: vi.fn().mockResolvedValue({ status: 'success' }) };
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    await sendPagerDutyAlert({ summary: 'DB down', severity: 'critical', source: 'api', component: 'db', group: 'database', details: { table: 'users' } });
    expect(requestBody.payload.summary).toBe('DB down');
    expect(requestBody.payload.source).toBe('api');
    expect(requestBody.payload.custom_details).toEqual({ table: 'users' });
    globalThis.fetch = originalFetch;
  });
});

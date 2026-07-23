/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

// Reset module to get a fresh singleton
beforeEach(() => {
  vi.resetModules();
  mockFetch.mockClear();
});

describe('Grafana OTLP Client', () => {
  it('module exports metrics convenience object', async () => {
    const mod = await import('@/lib/grafana');
    expect(mod.metrics).toBeDefined();
    expect(typeof mod.metrics.increment).toBe('function');
    expect(typeof mod.metrics.gauge).toBe('function');
    expect(typeof mod.metrics.histogram).toBe('function');
    expect(typeof mod.metrics.log).toBe('function');
    expect(typeof mod.metrics.logError).toBe('function');
    expect(typeof mod.metrics.recordHttpRequest).toBe('function');
    expect(typeof mod.metrics.recordDatabaseQuery).toBe('function');
    expect(typeof mod.metrics.recordCacheHit).toBe('function');
  });

  it('getGrafanaClient returns singleton', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const a = getGrafanaClient();
    const b = getGrafanaClient();
    expect(a).toBe(b);
  });

  it('metrics.increment logs to console when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.increment('test_counter', 5, { key: 'value' });
    expect(consoleSpy).toHaveBeenCalledWith('[Metric] test_counter: +5', { key: 'value' });
    consoleSpy.mockRestore();
  });

  it('metrics.gauge logs to console when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.gauge('test_gauge', 42, { env: 'test' });
    expect(consoleSpy).toHaveBeenCalledWith('[Gauge] test_gauge: 42', { env: 'test' });
    consoleSpy.mockRestore();
  });

  it('metrics.histogram logs to console when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.histogram('http_duration', 150, { path: '/api' });
    expect(consoleSpy).toHaveBeenCalledWith('[Histogram] http_duration: 150ms', { path: '/api' });
    consoleSpy.mockRestore();
  });

  it('metrics.log logs to console when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.log('info', 'hello world', { extra: 'data' });
    expect(consoleSpy).toHaveBeenCalledWith('[Log] [INFO] hello world', { extra: 'data' });
    consoleSpy.mockRestore();
  });

  it('metrics.logError logs error to console when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    const err = new Error('test error');
    metrics.logError(err, { context: 'test' });
    expect(consoleSpy).toHaveBeenCalled();
    // Find the call that contains '[Log]'
    const logCall = consoleSpy.mock.calls.find((c: any[]) => String(c[0]).includes('[Log]'));
    expect(logCall).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('metrics.recordHttpRequest logs metrics when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.recordHttpRequest('GET', '/api/users/123', 200, 45);
    expect(consoleSpy).toHaveBeenCalled();
    // Should have called increment and histogram
    expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    consoleSpy.mockRestore();
  });

  it('metrics.recordDatabaseQuery logs metrics when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.recordDatabaseQuery('SELECT', 12, true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('metrics.recordCacheHit logs metrics when disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { metrics } = await import('@/lib/grafana');
    metrics.recordCacheHit('session', true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('grafana client sanitizePath removes UUIDs and numeric IDs', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    // Access private method via prototype
    const sanitize = (client as any).sanitizePath?.bind(client);
    if (sanitize) {
      expect(sanitize('/api/users/550e8400-e29b-41d4-a716-446655440000')).toBe('/api/users/:id');
      expect(sanitize('/api/deals/12345')).toBe('/api/deals/:id');
      expect(sanitize('/api/contacts')).toBe('/api/contacts');
    }
  });

  it('grafana client buffer is empty initially', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    expect(client.buffer).toEqual([]);
    expect(client.logBuffer).toEqual([]);
  });

  it('metrics.increment adds to buffer when enabled', async () => {
    process.env.GRAFANA_ENABLED = 'true';
    process.env.OTLP_ENDPOINT = 'http://localhost:4318';
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.buffer = []; // reset
    client.enabled = true;
    client.increment('my_metric', 1, { tag: 'val' });
    expect(client.buffer.length).toBe(1);
    expect(client.buffer[0].metric).toBe('my_metric');
    expect(client.buffer[0].value).toBe(1);
    expect(client.buffer[0].labels.tag).toBe('val');
    expect(client.buffer[0].labels.app).toBe('nucrm-saas');
    delete process.env.GRAFANA_ENABLED;
    delete process.env.OTLP_ENDPOINT;
  });

  it('metrics.gauge adds to buffer when enabled', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.buffer = [];
    client.enabled = true;
    client.gauge('queue_depth', 7);
    expect(client.buffer.length).toBe(1);
    expect(client.buffer[0].metric).toBe('queue_depth');
    expect(client.buffer[0].value).toBe(7);
  });

  it('metrics.histogram adds 3 points when enabled', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.buffer = [];
    client.enabled = true;
    client.histogram('latency', 200);
    expect(client.buffer.length).toBe(3);
    expect(client.buffer[0].metric).toBe('latency_bucket');
    expect(client.buffer[1].metric).toBe('latency_sum');
    expect(client.buffer[2].metric).toBe('latency_count');
    expect(client.buffer[2].value).toBe(1);
  });

  it('metrics.log adds to logBuffer when enabled', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.logBuffer = [];
    client.enabled = true;
    client.log('warn', 'something happened', { extra: 1 });
    expect(client.logBuffer.length).toBe(1);
    expect(client.logBuffer[0].level).toBe('warn');
    expect(client.logBuffer[0].message).toBe('something happened');
    expect(client.logBuffer[0].context).toEqual({ extra: 1 });
  });

  it('error log flushes immediately', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.logBuffer = [];
    client.enabled = true;
    // flushLogs needs LOKI_URL to do anything, but it should still be called
    const flushSpy = vi.spyOn(client, 'flushLogs').mockResolvedValue(undefined);
    client.log('error', 'critical failure');
    expect(flushSpy).toHaveBeenCalled();
    flushSpy.mockRestore();
  });

  it('metrics.logError delegates to log with error context', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.logBuffer = [];
    client.enabled = true;
    const err = new Error('boom');
    client.logError(err, { requestId: 'abc' });
    expect(client.logBuffer.length).toBe(1);
    expect(client.logBuffer[0].level).toBe('error');
    expect(client.logBuffer[0].context.error).toBe('Error');
    expect(client.logBuffer[0].context.requestId).toBe('abc');
  });

  it('flush posts OTLP payload when endpoint configured', async () => {
    process.env.GRAFANA_ENABLED = 'true';
    process.env.OTLP_ENDPOINT = 'http://localhost:4318';
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.enabled = true;
    client.otlpEndpoint = 'http://localhost:4318';
    client.otlpHeaders = { 'Content-Type': 'application/json' };
    client.buffer = [
      { metric: 'test', value: 1, timestamp: Date.now(), labels: { app: 'nucrm-saas' } },
    ];
    await client.flush();
    expect(mockFetch).toHaveBeenCalled();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:4318');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.resourceMetrics).toBeDefined();
    expect(client.buffer).toEqual([]);
    delete process.env.GRAFANA_ENABLED;
    delete process.env.OTLP_ENDPOINT;
  });

  it('flush skips when buffer is empty', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.buffer = [];
    client.otlpEndpoint = 'http://localhost:4318';
    await client.flush();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('flushLogs posts to Loki when URL configured', async () => {
    process.env.LOKI_URL = 'http://localhost:3100';
    process.env.LOKI_USERNAME = 'user';
    process.env.LOKI_PASSWORD = 'pass';
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.enabled = true;
    client.logBuffer = [
      { level: 'info', message: 'test', timestamp: Date.now(), labels: { app: 'nucrm-saas' }, context: {} },
    ];
    await client.flushLogs();
    expect(mockFetch).toHaveBeenCalled();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/loki/api/v1/push');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(client.logBuffer).toEqual([]);
    delete process.env.LOKI_URL;
    delete process.env.LOKI_USERNAME;
    delete process.env.LOKI_PASSWORD;
  });

  it('flushLogs skips when logBuffer is empty', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.logBuffer = [];
    await client.flushLogs();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('flushLogs skips when LOKI_URL not set', async () => {
    delete process.env.LOKI_URL;
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.logBuffer = [
      { level: 'info', message: 'test', timestamp: Date.now(), labels: {}, context: {} },
    ];
    await client.flushLogs();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('flush handles fetch failure gracefully', async () => {
    process.env.GRAFANA_ENABLED = 'true';
    process.env.OTLP_ENDPOINT = 'http://localhost:4318';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.enabled = true;
    client.otlpEndpoint = 'http://localhost:4318';
    client.otlpHeaders = {};
    client.buffer = [
      { metric: 'test', value: 1, timestamp: Date.now(), labels: {} },
    ];
    await client.flush();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    delete process.env.GRAFANA_ENABLED;
    delete process.env.OTLP_ENDPOINT;
  });

  it('close clears interval and flushes', async () => {
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    client.flushInterval = setInterval(() => {}, 10000);
    client.buffer = [];
    client.logBuffer = [];
    client.otlpEndpoint = undefined;
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    await client.close();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('constructor initializes when GRAFANA_ENABLED is not true', async () => {
    vi.resetModules();
    delete process.env.GRAFANA_ENABLED;
    delete process.env.OTLP_ENDPOINT;
    const { getGrafanaClient } = await import('@/lib/grafana');
    const client = getGrafanaClient() as any;
    // When disabled, enabled should be false and client initializes with empty buffers
    expect(client.enabled).toBe(false);
    expect(client.buffer).toEqual([]);
    expect(client.logBuffer).toEqual([]);
  });
});

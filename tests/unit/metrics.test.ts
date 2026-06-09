import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('metrics', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV, PROMETHEUS_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('exports a metrics singleton', async () => {
    const { metrics } = await import('@/lib/metrics');
    expect(metrics).toBeDefined();
    expect(typeof metrics.increment).toBe('function');
    expect(typeof metrics.timing).toBe('function');
    expect(typeof metrics.gauge).toBe('function');
    expect(typeof metrics.getMetrics).toBe('function');
    expect(typeof metrics.reset).toBe('function');
  });

  it('increment adds a metric point', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    metrics.increment('test_count', 1, { env: 'test' });
    const points = metrics.getMetrics();
    expect(points.length).toBe(1);
    expect(points[0]!.name).toBe('test_count');
    expect(points[0]!.value).toBe(1);
  });

  it('timing adds a metric point with _ms suffix', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    metrics.timing('response_time', 150);
    const points = metrics.getMetrics();
    expect(points.length).toBe(1);
    expect(points[0]!.name).toBe('response_time_ms');
    expect(points[0]!.value).toBe(150);
  });

  it('gauge adds a metric point', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    metrics.gauge('memory_usage', 512);
    const points = metrics.getMetrics();
    expect(points.length).toBe(1);
    expect(points[0]!.name).toBe('memory_usage');
    expect(points[0]!.value).toBe(512);
  });

  it('reset clears all metrics', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.increment('test', 1);
    expect(metrics.getMetrics().length).toBeGreaterThan(0);
    metrics.reset();
    expect(metrics.getMetrics().length).toBe(0);
  });

  it('ring buffer overwrites oldest entries', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    for (let i = 0; i < 1000; i++) {
      metrics.increment(`metric_${i}`, i);
    }
    const points = metrics.getMetrics();
    expect(points.length).toBeLessThanOrEqual(1000);
  });
});

describe('trackRequest', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV, PROMETHEUS_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('records request metrics', async () => {
    const { trackRequest, metrics } = await import('@/lib/metrics');
    metrics.reset();
    trackRequest('GET', '/api/test', 200, 50);
    const points = metrics.getMetrics();
    expect(points.length).toBeGreaterThanOrEqual(2);
  });

  it('records error metrics for 5xx', async () => {
    const { trackRequest, metrics } = await import('@/lib/metrics');
    metrics.reset();
    trackRequest('POST', '/api/error', 500, 30);
    const points = metrics.getMetrics();
    const errorPoints = points.filter(p => p.name === 'http_errors_total');
    expect(errorPoints.length).toBeGreaterThan(0);
  });
});

describe('trackDatabaseQuery', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV, PROMETHEUS_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  const OLD_ENV = process.env;

  it('records db query metrics', async () => {
    const { trackDatabaseQuery, metrics } = await import('@/lib/metrics');
    metrics.reset();
    trackDatabaseQuery('contacts', 'SELECT', 5, true);
    const points = metrics.getMetrics();
    expect(points.length).toBeGreaterThanOrEqual(2);
  });
});

describe('exportPrometheusMetrics', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV, PROMETHEUS_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  const OLD_ENV = process.env;

  it('formats metrics as Prometheus text', async () => {
    const { metrics, exportPrometheusMetrics } = await import('@/lib/metrics');
    metrics.reset();
    metrics.increment('requests_total', 1, { method: 'GET' });
    const output = exportPrometheusMetrics();
    expect(output).toContain('requests_total');
    expect(output).toContain('method="GET"');
  });
});

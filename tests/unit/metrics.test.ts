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
    expect(points[0]!.labels).toEqual({ env: 'test' });
  });

  it('increment defaults value to 1', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    metrics.increment('requests');
    const points = metrics.getMetrics();
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
    metrics.gauge('memory_usage', 512, { host: 'web-1' });
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

  it('ring buffer overwrites oldest entries after MAX_METRICS', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    for (let i = 0; i < 11000; i++) {
      metrics.increment(`metric_${i}`, i);
    }
    const points = metrics.getMetrics();
    expect(points.length).toBe(10000);
    expect(points[0]!.name).toBe('metric_1000');
    expect(points[9999]!.name).toBe('metric_10999');
  });

  it('getMetrics returns in chronological order when buffer wrapped', async () => {
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    for (let i = 0; i < 10001; i++) {
      metrics.increment(`m${i}`, i);
    }
    const points = metrics.getMetrics();
    expect(points.length).toBe(10000);
    expect(points[0]!.value).toBe(1);
    expect(points[points.length - 1]!.value).toBe(10000);
  });

  it('does not record when PROMETHEUS_ENABLED is not true (testMode)', async () => {
    process.env.PROMETHEUS_ENABLED = 'false';
    const { metrics } = await import('@/lib/metrics');
    metrics.reset();
    metrics.increment('should_not_record', 1);
    metrics.timing('should_not_record', 100);
    metrics.gauge('should_not_record', 50);
    const points = metrics.getMetrics();
    expect(points.length).toBe(0);
  });

  describe('trackRequest', () => {
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
      const httpReq = points.find(p => p.name === 'http_requests_total');
      expect(httpReq).toBeDefined();
      expect(httpReq!.labels).toEqual({ method: 'GET', path: '/api/test', status: '200' });
    });

    it('records error metrics for 5xx responses', async () => {
      const { trackRequest, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackRequest('POST', '/api/error', 500, 30);
      const points = metrics.getMetrics();
      const errorPoints = points.filter(p => p.name === 'http_errors_total');
      expect(errorPoints.length).toBeGreaterThan(0);
      expect(errorPoints[0]!.labels!.type).toBe('server');
    });

    it('does not record error metrics for 4xx responses', async () => {
      const { trackRequest, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackRequest('GET', '/api/notfound', 404, 10);
      const points = metrics.getMetrics();
      const errorPoints = points.filter(p => p.name === 'http_errors_total');
      expect(errorPoints.length).toBe(0);
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

    it('records db query metrics with labels', async () => {
      const { trackDatabaseQuery, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackDatabaseQuery('contacts', 'SELECT', 5, true);
      const points = metrics.getMetrics();
      expect(points.length).toBeGreaterThanOrEqual(2);
      const dbReq = points.find(p => p.name === 'db_queries_total');
      expect(dbReq).toBeDefined();
      expect(dbReq!.labels).toEqual({ table: 'contacts', operation: 'SELECT', success: 'true' });
    });
  });

  describe('trackAuthEvent', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env = { ...OLD_ENV, PROMETHEUS_ENABLED: 'true' };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('records auth event metrics', async () => {
      const { trackAuthEvent, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackAuthEvent('login', true, 'user-1');
      const points = metrics.getMetrics();
      const authPoints = points.filter(p => p.name === 'auth_events_total');
      expect(authPoints.length).toBe(1);
      expect(authPoints[0]!.labels).toEqual({ event: 'login', success: 'true' });
    });

    it('records failed auth events', async () => {
      const { trackAuthEvent, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackAuthEvent('login', false);
      const points = metrics.getMetrics();
      const authPoints = points.filter(p => p.name === 'auth_events_total');
      expect(authPoints[0]!.labels!.success).toBe('false');
    });
  });

  describe('trackBusinessMetric', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env = { ...OLD_ENV, PROMETHEUS_ENABLED: 'true' };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('records business metric with tenant label', async () => {
      const { trackBusinessMetric, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackBusinessMetric('active_users', 42, 'tenant-abc');
      const points = metrics.getMetrics();
      const bizPoint = points.find(p => p.name === 'business_active_users');
      expect(bizPoint).toBeDefined();
      expect(bizPoint!.value).toBe(42);
      expect(bizPoint!.labels).toEqual({ tenant_id: 'tenant-abc' });
    });

    it('uses unknown tenant_id when not provided', async () => {
      const { trackBusinessMetric, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackBusinessMetric('revenue', 10000);
      const points = metrics.getMetrics();
      expect(points[0]!.labels!.tenant_id).toBe('unknown');
    });

    it('records gauge type metric', async () => {
      const { trackBusinessMetric, metrics } = await import('@/lib/metrics');
      metrics.reset();
      trackBusinessMetric('mrr', 50000, 'tenant-xyz');
      const points = metrics.getMetrics();
      expect(points[0]!.name).toBe('business_mrr');
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

    it('formats metrics as Prometheus text', async () => {
      const { metrics, exportPrometheusMetrics } = await import('@/lib/metrics');
      metrics.reset();
      metrics.increment('requests_total', 1, { method: 'GET' });
      const output = exportPrometheusMetrics();
      expect(output).toContain('requests_total');
      expect(output).toContain('method="GET"');
    });

    it('handles metrics without labels', async () => {
      const { metrics, exportPrometheusMetrics } = await import('@/lib/metrics');
      metrics.reset();
      metrics.gauge('uptime_seconds', 3600);
      const output = exportPrometheusMetrics();
      expect(output).toContain('uptime_seconds');
      expect(output).not.toContain('{');
    });

    it('returns empty string when no metrics', async () => {
      const { metrics, exportPrometheusMetrics } = await import('@/lib/metrics');
      metrics.reset();
      const output = exportPrometheusMetrics();
      expect(output).toBe('');
    });
  });
});

/**
 * Simple Metrics Collector for Local Development
 * 
 * During development, this collects and logs metrics to console.
 * In production, integrate with Prometheus/Grafana.
 * 
 * Features:
 * - Request counting
 * - Response time tracking
 * - Error rate tracking
 * - Database query metrics
 * 
 * Usage:
 * import { metrics } from '@/lib/metrics';
 * metrics.increment('requests.total');
 * metrics.timing('response.time', duration);
 */

export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

export interface MetricsCollector {
  increment(name: string, value?: number, labels?: Record<string, string>): void;
  timing(name: string, duration: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  getMetrics(): MetricPoint[];
  reset(): void;
}

class ConsoleMetricsCollector implements MetricsCollector {
  private metrics: MetricPoint[] = [];
  private testMode = process.env['PROMETHEUS_ENABLED'] !== 'true';

  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    if (this.testMode) {
      console.log(`📊 [METRIC] ${name}: +${value}`, labels ? JSON.stringify(labels) : '');
      return;
    }

    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  timing(name: string, duration: number, labels?: Record<string, string>): void {
    if (this.testMode) {
      console.log(`⏱️ [TIMING] ${name}: ${duration}ms`, labels ? JSON.stringify(labels) : '');
      return;
    }

    this.metrics.push({
      name: `${name}_ms`,
      value: duration,
      timestamp: Date.now(),
      labels,
    });
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    if (this.testMode) {
      console.log(`📈 [GAUGE] ${name}: ${value}`, labels ? JSON.stringify(labels) : '');
      return;
    }

    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  getMetrics(): MetricPoint[] {
    return [...this.metrics];
  }

  reset(): void {
    this.metrics = [];
  }
}

/**
 * Pre-defined metric helpers
 */
export const metrics = new ConsoleMetricsCollector();

/**
 * Track API request metrics
 */
export function trackRequest(
  method: string,
  path: string,
  status: number,
  duration: number
) {
  metrics.increment('http_requests_total', 1, {
    method,
    path,
    status: status.toString(),
  });

  metrics.timing('http_request_duration', duration, {
    method,
    path,
  });

  if (status >= 500) {
    metrics.increment('http_errors_total', 1, {
      method,
      path,
      type: 'server',
    });
  }
}

/**
 * Track database query metrics
 */
export function trackDatabaseQuery(
  table: string,
  operation: string,
  duration: number,
  success: boolean
) {
  metrics.increment('db_queries_total', 1, {
    table,
    operation,
    success: success.toString(),
  });

  metrics.timing('db_query_duration', duration, {
    table,
    operation,
  });
}

/**
 * Track authentication events
 */
export function trackAuthEvent(
  event: string,
  success: boolean,
  userId?: string
) {
  metrics.increment('auth_events_total', 1, {
    event,
    success: success.toString(),
  });
}

/**
 * Track business metrics
 */
export function trackBusinessMetric(
  name: string,
  value: number,
  tenantId?: string
) {
  metrics.gauge(`business_${name}`, value, {
    tenant_id: tenantId || 'unknown',
  });
}

/**
 * Export metrics in Prometheus format (for production)
 */
export function exportPrometheusMetrics(): string {
  const metricsData = metrics.getMetrics();
  const lines: string[] = [];

  // Group by metric name
  const grouped = new Map<string, MetricPoint[]>();
  for (const metric of metricsData) {
    const existing = grouped.get(metric.name) || [];
    existing.push(metric);
    grouped.set(metric.name, existing);
  }

  for (const [name, points] of grouped.entries()) {
    const latest = points[points.length - 1];
    if (latest) {
      const labels = latest.labels
        ? `{${Object.entries(latest.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
        : '';
      lines.push(`${name}${labels} ${latest.value}`);
    }
  }

  return lines.join('\n');
}

export default metrics;

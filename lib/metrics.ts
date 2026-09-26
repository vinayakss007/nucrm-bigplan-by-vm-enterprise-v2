/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
 * - FIXED: Ring buffer prevents unbounded memory growth
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
  kind?: 'counter' | 'gauge';
}

export interface MetricsCollector {
  increment(name: string, value?: number, labels?: Record<string, string>): void;
  timing(name: string, duration: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  getMetrics(): MetricPoint[];
  reset(): void;
}

/**
 * FIX: Ring buffer to prevent unbounded memory growth.
 * Keeps only the most recent MAX_METRICS entries.
 */
const MAX_METRICS = 10_000;

class ConsoleMetricsCollector implements MetricsCollector {
  private buffer: MetricPoint[] = [];
  private writeIndex = 0;
  private count = 0;
  private disabled = process.env['METRICS_DISABLED'] === 'true';

  private push(point: MetricPoint): void {
    if (this.count < MAX_METRICS) {
      this.buffer.push(point);
      this.count++;
    } else {
      // Overwrite oldest entry (ring buffer)
      this.buffer[this.writeIndex] = point;
    }
    this.writeIndex = (this.writeIndex + 1) % MAX_METRICS;
  }

  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    if (this.disabled) {
      return;
    }

    this.push({ name, value, timestamp: Date.now(), labels, kind: 'counter' });
  }

  timing(name: string, duration: number, labels?: Record<string, string>): void {
    if (this.disabled) {
      return;
    }

    this.push({ name: `${name}_ms`, value: duration, timestamp: Date.now(), labels, kind: 'gauge' });
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    if (this.disabled) {
      return;
    }

    this.push({ name, value, timestamp: Date.now(), labels, kind: 'gauge' });
  }

  getMetrics(): MetricPoint[] {
    // Return metrics in chronological order
    if (this.count < MAX_METRICS) {
      return [...this.buffer];
    }
    // Ring buffer is full — splice from write index for correct order
    return [
      ...this.buffer.slice(this.writeIndex),
      ...this.buffer.slice(0, this.writeIndex),
    ];
  }

  reset(): void {
    this.buffer = [];
    this.writeIndex = 0;
    this.count = 0;
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
  _userId?: string
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

  // One line per (name, labels) SERIES — grouping by name alone collapsed
  // e.g. http_requests_total{method,path,status} down to a single
  // last-written series, which made every rate()-based alert meaningless.
  // Counters export their cumulative sum since start (monotonic, so
  // rate()/increase() work); gauges and timings export their latest value.
  interface Series {
    name: string;
    labels: Record<string, string> | undefined;
    kind: 'counter' | 'gauge';
    sum: number;
    latest: number;
  }
  const series = new Map<string, Series>();
  for (const point of metricsData) {
    const key = `${point.name}\u0000${JSON.stringify(point.labels ?? {})}`;
    const existing = series.get(key);
    if (existing) {
      existing.sum += point.value;
      existing.latest = point.value;
    } else {
      series.set(key, {
        name: point.name,
        labels: point.labels,
        kind: point.kind ?? 'gauge',
        sum: point.value,
        latest: point.value,
      });
    }
  }

  const escapeLabelValue = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const lines: string[] = [];
  for (const s of series.values()) {
    const value = s.kind === 'counter' ? s.sum : s.latest;
    // Same rule as the route's push(): a NaN/Inf line invalidates the
    // whole Prometheus exposition, not just that metric.
    if (!Number.isFinite(value)) continue;
    const labels = s.labels
      ? `{${Object.entries(s.labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}`
      : '';
    lines.push(`${s.name}${labels} ${value}`);
  }

  return lines.join('\n');
}

export default metrics;

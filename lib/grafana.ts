/**
 * Grafana Cloud OTLP Integration
 * 
 * Sends application metrics to Grafana Cloud using OTLP/HTTP
 * Supports: Metrics, Logs (Loki), Traces (Tempo)
 */

import { EventEmitter } from 'events';

interface MetricPoint {
  metric: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
}

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  labels: Record<string, string>;
  context?: Record<string, any>;
}

class GrafanaOTLPClient extends EventEmitter {
  private enabled: boolean;
  private otlpEndpoint?: string;
  private otlpHeaders?: Record<string, string>;
  private buffer: MetricPoint[] = [];
  private logBuffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.enabled = process.env['GRAFANA_ENABLED'] === 'true';

    if (this.enabled) {
      this.otlpEndpoint = process.env['OTLP_ENDPOINT'];

      // Parse OTLP headers
      const authHeader = process.env['OTLP_HEADERS'] || '';
      this.otlpHeaders = {
        'Content-Type': 'application/json',
        'Authorization': authHeader.replace('Authorization=', 'Bearer '),
      };

      // Start flush interval (every 10 seconds)
      this.flushInterval = setInterval(() => this.flush(), 10000);
      
      console.log('[Grafana OTLP] Metrics enabled');
      console.log('[Grafana OTLP] Endpoint:', this.otlpEndpoint);
    } else {
      console.log('[Grafana] Metrics disabled - using console logging');
    }
  }

  /**
   * Record a counter metric
   */
  increment(metric: string, value: number = 1, labels: Record<string, string> = {}) {
    if (!this.enabled) {
      console.log(`[Metric] ${metric}: +${value}`, labels);
      return;
    }

    this.buffer.push({
      metric,
      value,
      timestamp: Date.now(),
      labels: {
        ...labels,
        app: 'nucrm-saas',
        env: process.env.NODE_ENV || 'development',
      },
    });
  }

  /**
   * Record a gauge metric (can go up or down)
   */
  gauge(metric: string, value: number, labels: Record<string, string> = {}) {
    if (!this.enabled) {
      console.log(`[Gauge] ${metric}: ${value}`, labels);
      return;
    }

    this.buffer.push({
      metric,
      value,
      timestamp: Date.now(),
      labels: {
        ...labels,
        app: 'nucrm-saas',
        env: process.env.NODE_ENV || 'development',
      },
    });
  }

  /**
   * Record a histogram metric (for latency distributions)
   */
  histogram(metric: string, value: number, labels: Record<string, string> = {}) {
    if (!this.enabled) {
      console.log(`[Histogram] ${metric}: ${value}ms`, labels);
      return;
    }

    this.buffer.push(
      {
        metric: `${metric}_bucket`,
        value,
        timestamp: Date.now(),
        labels: { ...labels, le: '+Inf', app: 'nucrm-saas', env: process.env.NODE_ENV || 'development' },
      },
      {
        metric: `${metric}_sum`,
        value,
        timestamp: Date.now(),
        labels: { ...labels, app: 'nucrm-saas', env: process.env.NODE_ENV || 'development' },
      },
      {
        metric: `${metric}_count`,
        value: 1,
        timestamp: Date.now(),
        labels: { ...labels, app: 'nucrm-saas', env: process.env.NODE_ENV || 'development' },
      }
    );
  }

  /**
   * Log an error to Loki
   */
  logError(error: Error, context: Record<string, any> = {}) {
    this.log('error', error.message, {
      error: error.name,
      stack: error.stack,
      ...context,
    });
  }

  /**
   * Log a message to Loki
   */
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, context: Record<string, any> = {}) {
    if (!this.enabled) {
      console.log(`[Log] [${level.toUpperCase()}] ${message}`, context);
      return;
    }

    this.logBuffer.push({
      level,
      message,
      timestamp: Date.now(),
      labels: {
        app: 'nucrm-saas',
        env: process.env.NODE_ENV || 'development',
        level,
      },
      context,
    });

    // Flush logs immediately for errors
    if (level === 'error') {
      this.flushLogs();
    }
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number
  ) {
    this.increment('http_requests_total', 1, {
      method,
      path: this.sanitizePath(path),
      status: String(statusCode),
    });

    this.histogram('http_request_duration_seconds', durationMs / 1000, {
      method,
      path: this.sanitizePath(path),
    });
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(
    queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
    durationMs: number,
    success: boolean
  ) {
    this.increment('db_queries_total', 1, {
      type: queryType,
      success: String(success),
    });

    this.histogram('db_query_duration_seconds', durationMs / 1000, {
      type: queryType,
    });
  }

  /**
   * Record cache metrics
   */
  recordCacheHit(cacheType: string, hit: boolean) {
    this.increment(`cache_${hit ? 'hits' : 'misses'}_total`, 1, {
      type: cacheType,
    });
  }

  /**
   * Sanitize path for metrics (remove IDs)
   */
  private sanitizePath(path: string): string {
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id');
  }

  /**
   * Convert metrics to OTLP format and flush
   */
  private async flush() {
    if (this.buffer.length === 0 || !this.otlpEndpoint) return;

    const metrics = [...this.buffer];
    this.buffer = [];

    try {
      // Convert to OTLP JSON format
      const otlpPayload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'nucrm-saas' } },
                { key: 'deployment.environment', value: { stringValue: process.env.NODE_ENV || 'development' } },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: 'nucrm-saas-metrics' },
                metrics: metrics.map(m => ({
                  name: m.metric,
                  unit: '1',
                  gauge: {
                    dataPoints: [
                      {
                        asDouble: m.value,
                        timeUnixNano: String(m.timestamp * 1000000),
                        attributes: Object.entries(m.labels).map(([key, value]) => ({
                          key,
                          value: { stringValue: value },
                        })),
                      },
                    ],
                  },
                })),
              },
            ],
          },
        ],
      };

      await fetch(this.otlpEndpoint, {
        method: 'POST',
        headers: this.otlpHeaders,
        body: JSON.stringify(otlpPayload),
      });
    } catch (error) {
      console.error('[Grafana OTLP] Failed to flush metrics:', error);
    }
  }

  /**
   * Flush logs to Loki
   */
  private async flushLogs() {
    if (this.logBuffer.length === 0) return;

    const lokiUrl = process.env['LOKI_URL'];
    if (!lokiUrl) return;

    const logs = [...this.logBuffer];
    this.logBuffer = [];

    try {
      const payload = {
        streams: [
          {
            stream: logs[0]!.labels,
            values: logs.map(log => [
              String(log.timestamp * 1000000),
              JSON.stringify({
                message: log.message,
                ...log.context,
              }),
            ]),
          },
        ],
      };

      const lokiUsername = process.env['LOKI_USERNAME'] || '';
      const lokiPassword = process.env['LOKI_PASSWORD'] || '';

      await fetch(`${lokiUrl}/loki/api/v1/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${lokiUsername}:${lokiPassword}`).toString('base64')}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('[Grafana] Failed to flush logs:', error);
    }
  }

  /**
   * Close the client and flush remaining data
   */
  async close() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    await this.flushLogs();
  }
}

// Singleton instance
let grafanaClient: GrafanaOTLPClient | null = null;

export function getGrafanaClient(): GrafanaOTLPClient {
  if (!grafanaClient) {
    grafanaClient = new GrafanaOTLPClient();
  }
  return grafanaClient;
}

// Convenience exports
export const metrics = {
  increment: (metric: string, value?: number, labels?: Record<string, string>) =>
    getGrafanaClient().increment(metric, value, labels),
  
  gauge: (metric: string, value: number, labels?: Record<string, string>) =>
    getGrafanaClient().gauge(metric, value, labels),
  
  histogram: (metric: string, value: number, labels?: Record<string, string>) =>
    getGrafanaClient().histogram(metric, value, labels),
  
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: Record<string, any>) =>
    getGrafanaClient().log(level, message, context),
  
  logError: (error: Error, context?: Record<string, any>) =>
    getGrafanaClient().logError(error, context),
  
  recordHttpRequest: (method: string, path: string, statusCode: number, durationMs: number) =>
    getGrafanaClient().recordHttpRequest(method, path, statusCode, durationMs),
  
  recordDatabaseQuery: (type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE', durationMs: number, success: boolean) =>
    getGrafanaClient().recordDatabaseQuery(type, durationMs, success),
  
  recordCacheHit: (type: string, hit: boolean) =>
    getGrafanaClient().recordCacheHit(type, hit),
};

export default metrics;

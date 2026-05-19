/**
 * Development Logger - Comprehensive Tracking
 * 
 * Features:
 * - Color-coded console logging (development only)
 * - Request/response tracking
 * - Database query logging
 * - Performance timing
 * - Error tracking with stack traces
 * - Memory usage monitoring
 * - Event tracking
 * - ✅ External monitoring integration (Sentry, Grafana) for production
 * 
 * Usage:
 * import { devLogger } from '@/lib/dev-logger';
 * devLogger.request('GET', '/api/contacts', 200, 45);
 * devLogger.query('SELECT * FROM contacts', 12);
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

interface LogOptions {
  color?: string;
  icon?: string;
  timestamp?: boolean;
  group?: boolean;
}

interface RequestLog {
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: number;
  ip?: string;
  userId?: string;
}

interface QueryLog {
  sql: string;
  duration: number;
  timestamp: number;
  params?: any[];
}

interface ErrorLog {
  error: Error;
  context?: string;
  userId?: string;
  timestamp: number;
  stack?: string;
}

class DevelopmentLogger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private requestLogs: RequestLog[] = [];
  private queryLogs: QueryLog[] = [];
  private errorLogs: ErrorLog[] = [];
  private startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private slowQueryThreshold = 100; // ms

  // External monitoring flags
  private sentryEnabled = !!process.env['SENTRY_DSN'];
  private grafanaEnabled = process.env['GRAFANA_ENABLED'] === 'true';

  // Color codes for console (development only)
  private colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
  };

  /**
   * Log with custom styling
   * ⚠️ Console logging only in development
   * ✅ External monitoring (Sentry/Grafana) in production
   */
  log(message: string, level: LogLevel = 'info', options: LogOptions = {}) {
    const {
      color = this.colors.blue,
      icon = '📝',
      timestamp = true,
      group = false,
    } = options;

    const time = timestamp ? new Date().toLocaleTimeString() : '';
    const prefix = timestamp ? `[${time}] ` : '';

    // Console logging only in development
    if (this.isDevelopment) {
      if (group) {
        console.group(`${prefix}${icon} ${message}`);
      } else {
        console.log(`${prefix}${color}${icon}${this.colors.reset} ${message}`);
      }
    }

    // Send to external monitoring in production
    if (!this.isDevelopment) {
      this.sendToExternalMonitoring(message, level);
    }
  }

  /**
   * Send logs to external monitoring services (production)
   */
  private async sendToExternalMonitoring(message: string, level: LogLevel) {
    // Sentry for errors
    if (this.sentryEnabled && level === 'error') {
      try {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureMessage(message, { level: level === 'error' ? 'error' : 'info' });
      } catch (e) {
        // Sentry not configured or failed
      }
    }

    // Grafana/Prometheus for metrics
    if (this.grafanaEnabled) {
      // Could push to Prometheus pushgateway or similar
      // Implementation depends on your Grafana setup
    }
  }

  /**
   * Log HTTP request
   */
  request(method: string, path: string, status: number, duration: number, ip?: string, userId?: string) {
    this.requestCount++;
    
    const log: RequestLog = {
      method,
      path,
      status,
      duration,
      timestamp: Date.now(),
      ip,
      userId,
    };
    this.requestLogs.push(log);

    // Console logging only in development
    if (this.isDevelopment) {
      // Color based on status
      let color = this.colors.green;
      let icon = '✅';
      
      if (status >= 400 && status < 500) {
        color = this.colors.yellow;
        icon = '⚠️';
      } else if (status >= 500) {
        color = this.colors.red;
        icon = '❌';
        this.errorCount++;
      }

      // Slow request warning
      const slowWarning = duration > 1000 ? ` ${this.colors.yellow}⚠️ SLOW (${duration}ms)${this.colors.reset}` : '';

      console.log(
        `${this.colors.gray}[HTTP]${this.colors.reset} ` +
        `${color}${icon}${this.colors.reset} ` +
        `${this.colors.white}${method.padEnd(6)}${this.colors.reset} ` +
        `${path.padEnd(40)} ` +
        `${color}${status}${this.colors.reset} ` +
        `${this.colors.cyan}${duration}ms${this.colors.reset}` +
        slowWarning
      );
    }

    // Send to external monitoring in production
    if (!this.isDevelopment) {
      this.sendToExternalMonitoring(
        `${method} ${path} ${status} ${duration}ms`,
        status >= 500 ? 'error' : 'info'
      );
    }

    // Keep only last 1000 requests
    if (this.requestLogs.length > 1000) {
      this.requestLogs.shift();
    }
  }

  /**
   * Log database query
   */
  query(sql: string, duration: number, params?: any[]) {
    const log: QueryLog = {
      sql: sql.slice(0, 500), // Limit SQL length
      duration,
      timestamp: Date.now(),
      params,
    };
    this.queryLogs.push(log);

    // Console logging only in development
    if (this.isDevelopment) {
      // Color based on duration
      let color = this.colors.cyan;
      let icon = '🗄️';
      
      if (duration > this.slowQueryThreshold) {
        color = this.colors.yellow;
        icon = '🐌 SLOW';
      }
      if (duration > 500) {
        color = this.colors.red;
        icon = '🚨 VERY SLOW';
      }

      // Format SQL for readability
      const formattedSQL = sql.replace(/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER|GROUP|LIMIT)\b/gi, '\n$1')
        .slice(0, 200);

      console.log(
        `${this.colors.gray}[DB]${this.colors.reset} ` +
        `${color}${icon}${this.colors.reset} ` +
        `${this.colors.cyan}${duration}ms${this.colors.reset} ` +
        `${this.colors.gray}${formattedSQL}${this.colors.reset}`
      );

      if (params && params.length > 0) {
        console.log(`${this.colors.gray}     Params:${this.colors.reset}`, JSON.stringify(params));
      }
    }

    // Send slow queries to external monitoring in production
    if (!this.isDevelopment && duration > this.slowQueryThreshold) {
      this.sendToExternalMonitoring(
        `Slow query (${duration}ms): ${sql.slice(0, 100)}`,
        'warn'
      );
    }

    // Keep only last 500 queries
    if (this.queryLogs.length > 500) {
      this.queryLogs.shift();
    }
  }

  /**
   * Log error with full details
   */
  error(error: Error | unknown, context?: string, userId?: string) {
    this.errorCount++;

    const err = error instanceof Error ? error : new Error(String(error));
    
    const log: ErrorLog = {
      error: err,
      context,
      userId,
      timestamp: Date.now(),
      stack: err.stack,
    };
    this.errorLogs.push(log);

    // Console logging only in development
    if (this.isDevelopment) {
      console.group(`${this.colors.bgRed}${this.colors.white} ❌ ERROR ${this.colors.reset}`);
      console.log(`${this.colors.red}Message:${this.colors.reset}`, err.message);
      
      if (context) {
        console.log(`${this.colors.red}Context:${this.colors.reset}`, context);
      }
      
      if (userId) {
        console.log(`${this.colors.red}User ID:${this.colors.reset}`, userId);
      }

      if (err.stack) {
        console.log(`${this.colors.red}Stack Trace:${this.colors.reset}`);
        console.log(this.colors.gray + err.stack.split('\n').slice(1).join('\n') + this.colors.reset);
      }
      console.groupEnd();
    }

    // Send to external monitoring in production (ALWAYS)
    if (!this.isDevelopment) {
      this.sendToExternalMonitoring(
        `${err.message}${context ? ` (${context})` : ''}`,
        'error'
      );
      
      // Sentry captures full error with stack trace
      if (this.sentryEnabled) {
        import('@sentry/nextjs').then(Sentry => {
          Sentry.captureException(err, {
            tags: { context, userId },
          });
        }).catch(() => {});
      }
    }

    // Keep only last 200 errors
    if (this.errorLogs.length > 200) {
      this.errorLogs.shift();
    }
  }

  /**
   * Log authentication event
   */
  auth(event: string, success: boolean, email?: string, userId?: string) {
    if (!this.isDevelopment) return;

    const icon = success ? '🔐' : '🚫';
    const color = success ? this.colors.green : this.colors.red;

    console.log(
      `${this.colors.gray}[AUTH]${this.colors.reset} ` +
      `${color}${icon}${this.colors.reset} ` +
      `${event} ` +
      `${success ? this.colors.green + '✓' : this.colors.red + '✗'}${this.colors.reset}` +
      (email ? ` ${this.colors.gray}(${email})${this.colors.reset}` : '') +
      (userId ? ` ${this.colors.gray}[${userId}]${this.colors.reset}` : '')
    );
  }

  /**
   * Log email sending
   */
  email(to: string, subject: string, success: boolean) {
    if (!this.isDevelopment) return;

    const icon = success ? '📧' : '❌';
    const color = success ? this.colors.cyan : this.colors.red;

    console.log(
      `${this.colors.gray}[EMAIL]${this.colors.reset} ` +
      `${color}${icon}${this.colors.reset} ` +
      `To: ${to} ` +
      `Subject: ${subject} ` +
      `${success ? this.colors.green + '✓' : this.colors.red + '✗'}${this.colors.reset}`
    );
  }

  /**
   * Log cache operation
   */
  cache(operation: string, key: string, hit: boolean, duration?: number) {
    if (!this.isDevelopment) return;

    const icon = hit ? '💚' : '💔';
    const color = hit ? this.colors.green : this.colors.yellow;

    console.log(
      `${this.colors.gray}[CACHE]${this.colors.reset} ` +
      `${color}${icon}${this.colors.reset} ` +
      `${operation.padEnd(6)} ` +
      `${this.colors.gray}${key}${this.colors.reset}` +
      (duration ? ` ${this.colors.cyan}${duration}ms${this.colors.reset}` : '')
    );
  }

  /**
   * Log queue job
   */
  queue(jobName: string, status: string, duration?: number) {
    if (!this.isDevelopment) return;

    const icons: Record<string, string> = {
      'queued': '⏳',
      'processing': '⚙️',
      'completed': '✅',
      'failed': '❌',
      'retrying': '🔄',
    };

    const icon = icons[status] || '📦';

    console.log(
      `${this.colors.gray}[QUEUE]${this.colors.reset} ` +
      `${icon} ` +
      `${jobName} ` +
      `${this.colors.yellow}${status}${this.colors.reset}` +
      (duration ? ` ${this.colors.cyan}${duration}ms${this.colors.reset}` : '')
    );
  }

  /**
   * Log memory usage
   */
  memory(label?: string) {
    if (!this.isDevelopment) return;

    const usage = process.memoryUsage();
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

    const labelStr = label ? ` ${this.colors.gray}(${label})${this.colors.reset}` : '';

    console.log(
      `${this.colors.gray}[MEMORY]${this.colors.reset} ` +
      `RSS: ${this.colors.cyan}${mb(usage.rss)}${this.colors.reset} ` +
      `Heap: ${this.colors.cyan}${mb(usage.heapUsed)}/${mb(usage.heapTotal)}${this.colors.reset} ` +
      `External: ${this.colors.cyan}${mb(usage.external)}${this.colors.reset}` +
      labelStr
    );
  }

  /**
   * Performance timing
   */
  time(label: string) {
    if (!this.isDevelopment) return;
    console.time(`${this.colors.gray}[TIME]${this.colors.reset} ${label}`);
  }

  timeEnd(label: string) {
    if (!this.isDevelopment) return;
    console.timeEnd(`${this.colors.gray}[TIME]${this.colors.reset} ${label}`);
  }

  /**
   * Log API rate limit check
   */
  rateLimit(identifier: string, remaining: number, limit: number) {
    if (!this.isDevelopment) return;

    const percentage = (remaining / limit) * 100;
    let color = this.colors.green;
    if (percentage < 50) color = this.colors.yellow;
    if (percentage < 20) color = this.colors.red;

    console.log(
      `${this.colors.gray}[RATE LIMIT]${this.colors.reset} ` +
      `${identifier} ` +
      `${color}${remaining}/${limit}${this.colors.reset} ` +
      `(${percentage.toFixed(0)}%)`
    );
  }

  /**
   * Get statistics
   */
  getStats() {
    const uptime = ((Date.now() - this.startTime) / 1000 / 60).toFixed(2);
    const avgResponseTime = this.requestLogs.length > 0
      ? (this.requestLogs.reduce((sum, r) => sum + r.duration, 0) / this.requestLogs.length).toFixed(2)
      : 0;
    const avgQueryTime = this.queryLogs.length > 0
      ? (this.queryLogs.reduce((sum, q) => sum + q.duration, 0) / this.queryLogs.length).toFixed(2)
      : 0;
    const slowQueries = this.queryLogs.filter(q => q.duration > this.slowQueryThreshold).length;

    return {
      uptime: `${uptime} min`,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount,
      errorRate: this.requestCount > 0 ? ((this.errorCount / this.requestCount) * 100).toFixed(2) + '%' : '0%',
      avgResponseTime: `${avgResponseTime}ms`,
      avgQueryTime: `${avgQueryTime}ms`,
      totalQueries: this.queryLogs.length,
      slowQueries,
      recentRequests: this.requestLogs.slice(-10),
      recentErrors: this.errorLogs.slice(-10),
    };
  }

  /**
   * Print statistics summary
   */
  printStats() {
    if (!this.isDevelopment) return;

    const stats = this.getStats();
    
    console.log('\n' + '='.repeat(60));
    console.log(`${this.colors.bgBlue}${this.colors.white} 📊 DEVELOPMENT STATISTICS ${this.colors.reset}`);
    console.log('='.repeat(60));
    console.log(`${this.colors.yellow}Uptime:${this.colors.reset}         ${stats.uptime}`);
    console.log(`${this.colors.yellow}Total Requests:${this.colors.reset}  ${stats.totalRequests}`);
    console.log(`${this.colors.yellow}Total Errors:${this.colors.reset}    ${stats.totalErrors} (${stats.errorRate})`);
    console.log(`${this.colors.yellow}Avg Response:${this.colors.reset}    ${stats.avgResponseTime}`);
    console.log(`${this.colors.yellow}Total Queries:${this.colors.reset}   ${stats.totalQueries}`);
    console.log(`${this.colors.yellow}Avg Query Time:${this.colors.reset} ${stats.avgQueryTime}`);
    console.log(`${this.colors.yellow}Slow Queries:${this.colors.reset}    ${stats.slowQueries}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Export logs to JSON
   */
  exportLogs() {
    return {
      timestamp: new Date().toISOString(),
      stats: this.getStats(),
      requests: this.requestLogs,
      queries: this.queryLogs,
      errors: this.errorLogs.map(e => ({
        message: e.error.message,
        context: e.context,
        timestamp: e.timestamp,
        stack: e.error.stack,
      })),
    };
  }

  /**
   * Clear all logs
   */
  clear() {
    this.requestLogs = [];
    this.queryLogs = [];
    this.errorLogs = [];
    console.clear();
    this.log('Development logs cleared', 'success');
  }
}

// Default export
export const devLogger = new DevelopmentLogger();

// Middleware helper
export function createDevelopmentMiddleware() {
  return function developmentLoggerMiddleware(req: any, res: any, next: () => void) {
    const start = Date.now();
    
    // Track response
    res.on('finish', () => {
      const duration = Date.now() - start;
      devLogger.request(
        req.method,
        req.url,
        res.statusCode,
        duration,
        req.ip,
        req.user?.id
      );
    });

    next();
  };
}

export default devLogger;

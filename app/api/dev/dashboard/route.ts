/**
 * Development Dashboard API
 * 
 * Provides real-time metrics and logs for development monitoring
 * 
 * ⚠️ SUPER ADMIN ONLY - Local dev tools disabled in production
 * ✅ External monitoring (Sentry, Grafana) works in production
 * 
 * Endpoints:
 * GET /api/dev/dashboard - Get dashboard data
 * GET /api/dev/logs - Get recent logs
 * GET /api/dev/stats - Get statistics
 * GET /api/dev/queries - Get database queries
 * GET /api/dev/errors - Get error logs
 * POST /api/dev/clear - Clear all logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { devLogger } from '@/lib/dev-logger';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { users } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Check if user is super admin
 * ⚠️ Local dev dashboard is ONLY for super admins
 * ✅ External monitoring (Sentry, Grafana) works in production
 */
async function requireSuperAdmin(req: NextRequest): Promise<{ userId: string; isSuperAdmin: boolean } | null> {
  // Dev dashboard disabled in production for security
  // Use Sentry/Grafana for production monitoring instead
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  // In development, verify super admin authentication
  try {
    const { verifyToken } = await import('@/lib/auth/session');

    // Get token from cookie in the request
    const tokenCookie = req.cookies.get('nucrm_session')?.value;
    if (!tokenCookie) {
      return null;
    }

    const payload = await verifyToken(tokenCookie);
    if (!payload) {
      return null;
    }

    // Check if user is super admin using Drizzle
    const [user] = await db.select({
      id: users.id,
      isSuperAdmin: users.isSuperAdmin
    })
    .from(users)
    .where(and(
      eq(users.id, payload.userId),
      sql`deleted_at IS NULL`
    ))
    .limit(1);

    if (!user || !user.isSuperAdmin) {
      return null;
    }

    return { userId: payload.userId, isSuperAdmin: true };
  } catch {
    return null;
  }
}

/**
 * GET /api/dev/dashboard
 * Get comprehensive dashboard data
 * 
 * ⚠️ SUPER ADMIN ONLY - Local dev tool
 * ✅ External monitoring flows to Sentry/Grafana in production
 */
export async function GET(request: NextRequest) {
  // ⚠️ LOCAL DEV DASHBOARD - Super admin only
  // Production monitoring should use Sentry/Grafana instead
  const admin = await requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const stats = devLogger.getStats();
  const logs = devLogger.exportLogs();

  // Get database stats using Drizzle execute for system tables
  let dbStats = null;
  try {
    const [tableCount, rowCount, connectionCount] = await Promise.all([
      db.execute(sql`SELECT count(*) as count FROM information_schema.tables WHERE table_schema = 'public'`),
      db.execute(sql`SELECT sum(n_live_tup) as count FROM pg_stat_user_tables`),
      db.execute(sql`SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'`),
    ]);

    dbStats = {
      tables: parseInt((tableCount.rows[0] as any)?.count || '0'),
      totalRows: parseInt((rowCount.rows[0] as any)?.count || '0'),
      activeConnections: parseInt((connectionCount.rows[0] as any)?.count || '0'),
    };
  } catch (error) {
    console.error('Failed to get DB stats:', error);
  }

  // Get memory usage
  const memoryUsage = process.memoryUsage();
  const memory = {
    rss: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100,
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
    external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100,
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    stats,
    logs,
    dbStats,
    memory,
    environment: {
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: (process.env as any).DATABASE_URL ? 'configured' : 'not configured',
      resendApiKey: (process.env as any).RESEND_API_KEY ? ((process.env as any).RESEND_API_KEY.startsWith('re_test_') ? 'test mode' : 'configured') : 'not configured',
      sentryDsn: (process.env as any).SENTRY_DSN ? 'configured' : 'not configured',
      databaseSsl: (process.env as any).DATABASE_SSL,
      databasePoolSize: (process.env as any).DATABASE_POOL_SIZE,
    },
    _meta: {
      accessLevel: 'super-admin-only',
      environment: process.env.NODE_ENV,
      note: 'Local dev dashboard - use Sentry/Grafana for production monitoring',
      productionMonitoring: {
        errors: 'Sentry (if configured)',
        metrics: 'Grafana/Prometheus (if configured)',
        logs: 'External log aggregator (if configured)',
      },
    },
  });
}

/**
 * GET /api/dev/logs
 * Get recent HTTP request logs
 */
export async function GET_LOGS(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Development only' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100');

  const stats = devLogger.getStats();

  return NextResponse.json({
    requests: stats.recentRequests.slice(-limit),
    errors: stats.recentErrors.slice(-limit / 2),
  });
}

/**
 * GET /api/dev/stats
 * Get current statistics
 */
export async function GET_STATS(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Development only' }, { status: 403 });
  }

  return NextResponse.json(devLogger.getStats());
}

/**
 * GET /api/dev/queries
 * Get database query logs
 */
export async function GET_QUERIES(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Development only' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const slowOnly = url.searchParams.get('slow') === 'true';
  const threshold = parseInt(url.searchParams.get('threshold') || '100');

  const logs = devLogger.exportLogs();
  let queries = logs.queries;

  if (slowOnly) {
    queries = queries.filter(q => q.duration > threshold);
  }

  return NextResponse.json({
    queries: queries.slice(-limit),
    total: queries.length,
    slow: queries.filter(q => q.duration > threshold).length,
  });
}

/**
 * GET /api/dev/errors
 * Get error logs
 */
export async function GET_ERRORS(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Development only' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');

  const logs = devLogger.exportLogs();

  return NextResponse.json({
    errors: logs.errors.slice(-limit).map(e => ({
      message: e.message,
      context: e.context,
      timestamp: new Date(e.timestamp).toISOString(),
      stack: e.stack,
    })),
    total: logs.errors.length,
  });
}

/**
 * POST /api/dev/clear
 * Clear all logs
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Development only' }, { status: 403 });
  }

  devLogger.clear();

  return NextResponse.json({
    success: true,
    message: 'All development logs cleared',
  });
}

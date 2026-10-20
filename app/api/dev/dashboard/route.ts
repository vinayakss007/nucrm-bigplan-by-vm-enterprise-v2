/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Development Dashboard API
 *
 * Provides real-time metrics and logs for development monitoring
 *
 * ⚠️ SUPER ADMIN ONLY - Local dev tools disabled in production
 * ✅ External monitoring (Sentry, Grafana) works in production
 *
 * This module answers two URLs, and no others:
 *   GET  /api/dev/dashboard  — stats, the log export, DB counters, environment
 *   POST /api/dev/dashboard  — clear the development log buffers
 *
 * The per-panel reads the page polls are siblings, not exports of this file:
 *   GET /api/dev/logs    → app/api/dev/logs/route.ts
 *   GET /api/dev/queries → app/api/dev/queries/route.ts
 *   GET /api/dev/errors  → app/api/dev/errors/route.ts
 *
 * #2881: this header used to advertise three more GET endpoints and a log-clearing
 * POST as if they lived here, and a panel was written against the list. A route
 * module only routes its HTTP-method exports, so the `GET_QUERIES` / `GET_ERRORS`
 * functions that matched two of those names were never reachable — see the route
 * files that replaced them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { devLogger } from '@/lib/dev-logger';
import { requireDevAccess, requireSuperAdmin } from '@/lib/dev-access';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

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
      tables: parseInt(((tableCount.rows[0] as Record<string, unknown>)?.count as string) || '0'),
      totalRows: parseInt(((rowCount.rows[0] as Record<string, unknown>)?.count as string) || '0'),
      activeConnections: parseInt(((connectionCount.rows[0] as Record<string, unknown>)?.count as string) || '0'),
    };
  } catch (error) {
    void logError({ error, context: 'dev/dashboard db-stats', level: 'warning' });
  }

  // #2881: the page's `DashboardData` has always read `uptime`, `nodeVersion` and
  // `memory.{rss,heapUsed,heapTotal,external}`, and this response never carried them.
  // `data.memory.rss` is not an optional field to the renderer — it is read straight
  // off the object, so the Overview tab threw and the dashboard never drew at all.
  // They are cheap to answer honestly, so they are answered, not removed from the type.
  const memory = process.memoryUsage();
  const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    memory: {
      rss: toMb(memory.rss),
      heapUsed: toMb(memory.heapUsed),
      heapTotal: toMb(memory.heapTotal),
      external: toMb(memory.external),
    },
    stats,
    logs,
    dbStats,
    environment: {
      nodeEnv: process.env.NODE_ENV,
      // #1138: infra config presence/values (DATABASE_URL, SENTRY_DSN,
      // DATABASE_SSL, DATABASE_POOL_SIZE, RESEND_API_KEY) are only exposed in
      // development. In production this dashboard should not report the
      // deployment's configuration surface — that belongs in Sentry/Grafana,
      // not an API response (even a super-admin one). The dev-only data reads
      // (/api/dev/logs, /queries, /errors) gate on this the same way, and
      // additionally on the caller being a super admin.
      ...(process.env.NODE_ENV === 'development'
        ? {
            databaseUrl: (process.env as Record<string, string | undefined>).DATABASE_URL ? 'configured' : 'not configured',
            resendApiKey: (process.env as Record<string, string | undefined>).RESEND_API_KEY ? ((process.env as Record<string, string | undefined>).RESEND_API_KEY?.startsWith('re_test_') ? 'test mode' : 'configured') : 'not configured',
            sentryDsn: (process.env as Record<string, string | undefined>).SENTRY_DSN ? 'configured' : 'not configured',
            databaseSsl: (process.env as Record<string, string | undefined>).DATABASE_SSL,
            databasePoolSize: (process.env as Record<string, string | undefined>).DATABASE_POOL_SIZE,
          }
        : { config: 'not exposed outside development' }),
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
 * POST /api/dev/dashboard
 * Clear the development log buffers
 */
export async function POST(request: NextRequest) {
  // Clearing is privileged too, and it is a dev-only affordance: same gate as the
  // three read endpoints that feed the panels these buffers back into.
  const access = await requireDevAccess(request);
  if (access instanceof NextResponse) return access;

  devLogger.clear();

  return NextResponse.json({
    success: true,
    message: 'All development logs cleared',
  });
}

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * GET /api/health
 * Health check endpoint with optional Sentry test
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const testError = searchParams.get('test-sentry');

  try {
    // Check DB
    let dbStatus = 'disconnected';
    let schemaReady = false;
    try {
      const res = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='users'`);
      dbStatus = 'connected';
      schemaReady = res.rowCount! > 0;
    } catch {
      dbStatus = 'error';
    }

    // Test Sentry if requested
    if (testError === 'true') {
      try {
        throw new Error('Sentry test error from NuCRM health endpoint');
      } catch (err) {
        Sentry.captureException(err, {
          tags: { test: true, endpoint: 'health' },
          level: 'info',
        });
      }
      return NextResponse.json({
        status: 'ok',
        db: dbStatus,
        schema_ready: schemaReady,
        sentry: 'test error sent (check Sentry dashboard)',
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: 'ok',
      db: dbStatus,
      schema_ready: schemaReady,
      service: 'nucrm-app',
      version: process.env['npm_package_version'] || '1.0.0',
      sentry: process.env['SENTRY_DSN'] ? 'configured' : 'not configured',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

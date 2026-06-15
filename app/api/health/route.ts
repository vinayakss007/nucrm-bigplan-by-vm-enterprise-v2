import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

function _timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('db timeout')), ms)
  );
}

export async function GET(request: NextRequest) {
  const testErrorParam = request.nextUrl.searchParams.get('test_error');

  try {
    let dbStatus = 'disconnected';
    let schemaReady = false;
    try {
      const res = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='users'`);
      dbStatus = 'connected';
      schemaReady = res.rowCount! > 0;
    } catch {
      dbStatus = 'error';
    }

    if (testErrorParam === 'true') {
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

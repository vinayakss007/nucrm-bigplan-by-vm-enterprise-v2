/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

function _timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('db timeout')), ms)
  );
}

/**
 * #1972: the DB + pg_tables probe is ~1.7s over a WAN database and deploy
 * gates poll this endpoint in a tight loop. Cache the probe briefly so only
 * one caller per window pays the cost; every other poll gets the same verdict
 * instantly. `?fresh=true` bypasses the cache (used by deploy gates right
 * after a migration, where a stale 'ok' must never mask a broken schema).
 */
const HEALTH_CACHE_TTL_MS = 5_000;
let healthProbe: { dbStatus: string; schemaReady: boolean; checkedAt: number } | null = null;

async function probeDb(): Promise<{ dbStatus: string; schemaReady: boolean }> {
  const now = Date.now();
  if (healthProbe && now - healthProbe.checkedAt < HEALTH_CACHE_TTL_MS) {
    return healthProbe;
  }
  let dbStatus = 'disconnected';
  let schemaReady = false;
  try {
    const res = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='users'`);
    dbStatus = 'connected';
    schemaReady = res.rowCount! > 0;
  } catch (err) {
    console.error('[health] DB check failed:', err);
    dbStatus = 'error';
  }
  healthProbe = { dbStatus, schemaReady, checkedAt: now };
  return healthProbe;
}

export async function GET(request: NextRequest) {
  const testErrorParam = request.nextUrl.searchParams.get('test_error');
  if (request.nextUrl.searchParams.get('fresh') === 'true') healthProbe = null;

  try {
    const { dbStatus, schemaReady } = await probeDb();

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

    const healthy = dbStatus === 'connected' && schemaReady;
    return NextResponse.json({
      status: healthy ? 'ok' : 'error',
      db: dbStatus,
      schema_ready: schemaReady,
      service: 'nucrm-app',
      version: process.env['npm_package_version'] || '1.0.0',
      sentry: process.env['SENTRY_DSN'] ? 'configured' : 'not configured',
      timestamp: new Date().toISOString(),
    }, { status: healthy ? 200 : 503 });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

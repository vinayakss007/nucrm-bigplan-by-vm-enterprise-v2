/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/health — readiness.
 *
 * #1972: this endpoint used to run a fresh synchronous DB query on EVERY
 * call. The deploy gate polls it in a loop and Docker/compose healthchecks
 * hit it every 30s, and against the WAN-hosted DB each probe cost ~1.7s —
 * slowing deploys and risking gate timeouts. The probe result is now cached
 * for PROBE_CACHE_TTL_MS and deduplicated across concurrent callers, with a
 * hard PROBE_TIMEOUT_MS ceiling so a hung pool answers 503 fast instead of
 * holding the request. The wire format is unchanged — launch-gate.sh still
 * asserts `"status":"ok" + "db":"connected" + "schema_ready":true`.
 *
 * Pure liveness (process up, no DB) lives at /api/health/live.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

const PROBE_CACHE_TTL_MS = 5_000;
const PROBE_TIMEOUT_MS = 3_000;

type ProbeResult = { dbStatus: 'connected' | 'error'; schemaReady: boolean };

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('db timeout')), ms)
  );
}

let cachedProbe: { at: number; result: ProbeResult } | null = null;
let pendingProbe: Promise<ProbeResult> | null = null;

async function probeDatabase(): Promise<ProbeResult> {
  if (cachedProbe && Date.now() - cachedProbe.at < PROBE_CACHE_TTL_MS) {
    return cachedProbe.result;
  }
  if (!pendingProbe) {
    pendingProbe = (async (): Promise<ProbeResult> => {
      let result: ProbeResult = { dbStatus: 'error', schemaReady: false };
      try {
        const res = await Promise.race([
          db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='users'`),
          timeout(PROBE_TIMEOUT_MS),
        ]);
        result = { dbStatus: 'connected', schemaReady: (res.rowCount ?? 0) > 0 };
      } catch (err) {
        console.error('[health] DB check failed:', err);
      }
      cachedProbe = { at: Date.now(), result };
      return result;
    })().finally(() => { pendingProbe = null; });
  }
  return pendingProbe;
}

export async function GET(request: NextRequest) {
  const testErrorParam = request.nextUrl.searchParams.get('test_error');

  try {
    const { dbStatus, schemaReady } = await probeDatabase();

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

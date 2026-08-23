/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { healthChecks } from '@/drizzle/schema';
import { sql, desc, gt } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

async function runCheck(service: string, fn: () => Promise<{ latency_ms: number; message: string }>) {
  try {
    const result = await fn();
    return { service, status: 'up', ...result };
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { service, status: 'down', latency_ms: 0, message: e.message };
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const checks = await Promise.all([
      runCheck('database', async () => {
        const t = Date.now(); 
        await db.execute(sql`SELECT 1`); 
        return { latency_ms: Date.now() - t, message: 'Connected' };
      }),
      runCheck('app', async () => {
        return { latency_ms: 0, message: `Node ${process.version} · Uptime ${Math.floor(process.uptime())}s` };
      }),
      runCheck('email', async () => {
        const key = process.env.RESEND_API_KEY;
        if (!key) return { latency_ms: 0, message: 'Not configured' };
        const t = Date.now();
        await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
        return { latency_ms: Date.now() - t, message: 'Resend OK' };
      }),
      runCheck('object_storage', async () => {
        const { getS3Config } = await import('@/lib/storage/s3-config');
        const cfg = getS3Config();
        if (!cfg.configured) return { latency_ms: 0, message: 'Not configured (MinIO dev-only)' };
        const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
        const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: cfg.credentials });
        const t = Date.now();
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        return { latency_ms: Date.now() - t, message: `Bucket ${cfg.bucket} reachable` };
      }),
    ]);

    // Persist
    for (const c of checks) {
      await db.insert(healthChecks).values({
        service: c.service,
        status: c.status === 'up' ? 'ok' : 'error',
        latencyMs: c.latency_ms,
        message: c.message,
      }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

    const history = await db
      .select({
        service: healthChecks.service,
        status: healthChecks.status,
        latencyMs: healthChecks.latencyMs,
        checkedAt: sql<string>`${healthChecks.checkedAt}::text`,
      })
      .from(healthChecks)
      .where(gt(healthChecks.checkedAt, sql`now() - interval '24 hours'`))
      .orderBy(desc(healthChecks.checkedAt))
      .limit(300)
      .catch((err) => { console.error('[health] history failed', err); return []; });

    return NextResponse.json({ checks, history });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/health GET]', err);
    return apiError(err);
  }
}


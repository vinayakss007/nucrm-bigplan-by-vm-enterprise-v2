import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { healthChecks } from '@/drizzle/schema';
import { eq, and, sql, desc, gt } from 'drizzle-orm';

async function runCheck(service: string, fn: () => Promise<{ latency_ms: number; message: string }>) {
  try {
    const result = await fn();
    return { service, status: 'up', ...result };
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
    ]);

    // Persist
    for (const c of checks) {
      await db.insert(healthChecks).values({
        service: c.service,
        status: c.status === 'up' ? 'ok' : 'error',
        latencyMs: c.latency_ms,
        message: c.message,
      }).catch(() => {});
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
      .catch(() => []);

    return NextResponse.json({ checks, history });
  } catch (err: any) {
    console.error('[superadmin/health GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


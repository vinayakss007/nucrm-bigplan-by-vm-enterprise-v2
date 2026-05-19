import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { errorLogs, tenants, users } from '@/drizzle/schema';
import { eq, and, sql, desc, gt, inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level');
    const resolved = searchParams.get('resolved');
    const limit = Math.min(200, parseInt(searchParams.get('limit') || '50'));

    const filters = [];
    if (level) {
      filters.push(eq(errorLogs.level, level));
    }
    if (resolved !== null && resolved !== '') {
      filters.push(eq(errorLogs.resolved, resolved === 'true'));
    }

    const [errors, summary] = await Promise.all([
      db
        .select({
          id: errorLogs.id,
          level: errorLogs.level,
          code: errorLogs.code,
          message: errorLogs.message,
          tenant_id: errorLogs.tenantId,
          user_id: errorLogs.userId,
          stack: errorLogs.stack,
          context: errorLogs.context,
          resolved: errorLogs.resolved,
          resolved_at: errorLogs.resolvedAt,
          created_at: errorLogs.createdAt,
          tenant_name: tenants.name,
          user_email: users.email,
        })
        .from(errorLogs)
        .leftJoin(tenants, eq(tenants.id, errorLogs.tenantId))
        .leftJoin(users, eq(users.id, errorLogs.userId))
        .where(and(...filters))
        .orderBy(desc(errorLogs.createdAt))
        .limit(limit)
        .catch(() => []),

      db
        .select({
          fatal_unresolved: sql<number>`count(*) FILTER (WHERE NOT ${errorLogs.resolved} AND ${errorLogs.level} = 'fatal')::int`,
          error_unresolved: sql<number>`count(*) FILTER (WHERE NOT ${errorLogs.resolved} AND ${errorLogs.level} = 'error')::int`,
          warn_unresolved: sql<number>`count(*) FILTER (WHERE NOT ${errorLogs.resolved} AND ${errorLogs.level} = 'warn')::int`,
          last_hour: sql<number>`count(*) FILTER (WHERE ${errorLogs.createdAt} > now() - interval '1 hour')::int`,
          last_day: sql<number>`count(*) FILTER (WHERE ${errorLogs.createdAt} > now() - interval '24 hours')::int`,
        })
        .from(errorLogs)
        .then(rows => rows[0])
        .catch(() => ({ fatal_unresolved: 0, error_unresolved: 0, warn_unresolved: 0, last_hour: 0, last_day: 0 })),
    ]);

    return NextResponse.json({ errors, summary });
  } catch (err: any) {
    console.error('[superadmin/errors GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { level = 'error', code, message, tenant_id, stack, context } = await request.json();
    await db.insert(errorLogs).values({
      level,
      code: code || null,
      message,
      tenantId: tenant_id || null,
      stack: stack || null,
      context: context || null,
    }).catch(() => {});
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: true }, { status: 201 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id, resolveAll, level } = await request.json();
    
    if (resolveAll) {
      const filters = [eq(errorLogs.resolved, false)];
      if (level) filters.push(eq(errorLogs.level, level));

      await db
        .update(errorLogs)
        .set({ resolved: true, resolvedAt: new Date(), resolvedBy: ctx.userId })
        .where(and(...filters));
    } else if (id) {
      await db
        .update(errorLogs)
        .set({ resolved: true, resolvedAt: new Date(), resolvedBy: ctx.userId })
        .where(eq(errorLogs.id, id));
    }
    
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[superadmin/errors PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


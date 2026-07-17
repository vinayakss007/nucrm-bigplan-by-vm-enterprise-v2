import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { auditLogs, users } from '@/drizzle/schema';
import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const action = searchParams.get('action');
    const entityType = searchParams.get('entity_type');
    const userId = searchParams.get('user_id');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [eq(auditLogs.tenantId, ctx.tenantId)];

    if (action) filters.push(eq(auditLogs.action, action));
    if (entityType) filters.push(eq(auditLogs.entityType, entityType));
    if (userId) filters.push(eq(auditLogs.userId, userId));
    if (dateFrom) filters.push(gte(auditLogs.createdAt, new Date(dateFrom)));
    if (dateTo) filters.push(lte(auditLogs.createdAt, new Date(dateTo)));
    if (search) {
      filters.push(
        sql`(${auditLogs.action} ILIKE ${'%' + search + '%'} OR ${auditLogs.entityType} ILIKE ${'%' + search + '%'})`
      );
    }

    const where = and(...filters);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where);

    const logs = await db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      resource_type: auditLogs.entityType,
      resource_id: auditLogs.entityId,
      created_at: auditLogs.createdAt,
      ip_address: auditLogs.ipAddress,
      old_data: auditLogs.oldData,
      new_data: auditLogs.newData,
      full_name: users.fullName,
      email: users.email,
      user_id: auditLogs.userId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({
      logs,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[AUDIT_API]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

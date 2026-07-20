import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { auditLogs, users, editHistory } from '@/drizzle/schema';
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
    const entityId = searchParams.get('entity_id');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [eq(auditLogs.tenantId, ctx.tenantId)];

    if (action) filters.push(eq(auditLogs.action, action));
    if (entityType) filters.push(eq(auditLogs.entityType, entityType));
    if (userId) filters.push(eq(auditLogs.userId, userId));
    if (entityId) filters.push(eq(auditLogs.entityId, entityId));
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

    const auditLogIds = logs.map(l => l.id).filter(Boolean);

    let fieldChanges: {
      id: string;
      entity_type: string;
      entity_id: string;
      field_name: string;
      field_label: string | null;
      old_value: string | null;
      new_value: string | null;
      change_type: string;
      user_name: string | null;
      user_email: string | null;
      created_at: Date | null;
    }[] = [];

    if (auditLogIds.length > 0) {
      fieldChanges = await db.select({
        id: editHistory.id,
        entity_type: editHistory.entityType,
        entity_id: editHistory.entityId,
        field_name: editHistory.fieldName,
        field_label: editHistory.fieldLabel,
        old_value: editHistory.oldValue,
        new_value: editHistory.newValue,
        change_type: editHistory.changeType,
        user_name: editHistory.userName,
        user_email: editHistory.userEmail,
        created_at: editHistory.createdAt,
      })
      .from(editHistory)
      .where(and(
        eq(editHistory.tenantId, ctx.tenantId),
        sql`${editHistory.entityType} IN (SELECT DISTINCT ${auditLogs.entityType} FROM ${auditLogs} WHERE ${where})`,
        sql`${editHistory.entityId} IN (SELECT DISTINCT ${auditLogs.entityId} FROM ${auditLogs} WHERE ${where} AND ${auditLogs.entityId} IS NOT NULL)`,
      ))
      .orderBy(desc(editHistory.createdAt))
      .limit(limit * 5);
    }

    const changesByEntity = new Map<string, typeof fieldChanges>();
    for (const change of fieldChanges) {
      const key = `${change.entity_type}:${change.entity_id}`;
      if (!changesByEntity.has(key)) changesByEntity.set(key, []);
      changesByEntity.get(key)!.push(change);
    }

    const logsWithChanges = logs.map(log => ({
      ...log,
      field_changes: log.resource_id
        ? changesByEntity.get(`${log.resource_type}:${log.resource_id}`) ?? []
        : [],
    }));

    return NextResponse.json({
      logs: logsWithChanges,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[AUDIT_API]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { apiError } from '@/lib/api-error';
/**
 * Super Admin Audit Logs API
 * GET /api/super-admin/audit-logs - List audit logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { superAdminAuditLogs } from '@/drizzle/schema';
import { requireAuth } from '@/lib/auth/middleware';
import { eq, and, gte, lte, desc, count } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const adminId = searchParams.get('admin_id');
    const action = searchParams.get('action');
    const targetType = searchParams.get('target_type');
    const tenantId = searchParams.get('tenant_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));
    const offset = parseInt(searchParams.get('offset') ?? '0');

    const conditions = [];

    if (adminId) {
      conditions.push(eq(superAdminAuditLogs.adminId, adminId));
    }
    if (action) {
      conditions.push(eq(superAdminAuditLogs.action, action));
    }
    if (targetType) {
      conditions.push(eq(superAdminAuditLogs.targetType, targetType));
    }
    if (tenantId) {
      conditions.push(eq(superAdminAuditLogs.tenantId, tenantId));
    }
    if (startDate) {
      conditions.push(gte(superAdminAuditLogs.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(superAdminAuditLogs.createdAt, new Date(endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logsResult = await db
      .select()
      .from(superAdminAuditLogs)
      .where(whereClause)
      .orderBy(desc(superAdminAuditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ total: count() })
      .from(superAdminAuditLogs)
      .where(whereClause);

    return NextResponse.json({
      data: logsResult,
      total: countResult[0]?.total ?? 0,
      limit,
      offset,
    });

  } catch (err) {
    console.error('[super-admin audit-logs GET]', err);
    return apiError(err);
  }
}

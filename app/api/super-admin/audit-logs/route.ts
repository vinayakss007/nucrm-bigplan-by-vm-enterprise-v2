/**
 * Super Admin Audit Logs API
 * GET /api/super-admin/audit-logs - List audit logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Check if user is super admin
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

    // Build query conditions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (adminId) {
      conditions.push(`admin_id = $${paramIndex++}`);
      params.push(adminId);
    }
    if (action) {
      conditions.push(`action = $${paramIndex++}`);
      params.push(action);
    }
    if (targetType) {
      conditions.push(`target_type = $${paramIndex++}`);
      params.push(targetType);
    }
    if (tenantId) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      params.push(tenantId);
    }
    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(new Date(startDate));
    }
    if (endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(new Date(endDate));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query audit logs
    const logsResult = await db.execute(sql`
      SELECT * FROM super_admin_audit_logs
      ${sql.raw(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    // Get total count
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM super_admin_audit_logs
      ${sql.raw(whereClause)}
    `);

    return NextResponse.json({
      data: (logsResult as any)?.rows || [],
      total: (countResult as any)?.rows?.[0]?.total ?? 0,
      limit,
      offset,
    });

  } catch (err: any) {
    console.error('[super-admin audit-logs GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
import { apiError } from '@/lib/api-error';
/**
 * Super Admin Audit Logs API
 * GET /api/superadmin/audit-logs - List audit logs (canonical path)
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

    // Build query conditions using Drizzle sql interpolation
    const conditions: ReturnType<typeof sql>[] = [];

    if (adminId) conditions.push(sql`admin_id = ${adminId}`);
    if (action) conditions.push(sql`action = ${action}`);
    if (targetType) conditions.push(sql`target_type = ${targetType}`);
    if (tenantId) conditions.push(sql`tenant_id = ${tenantId}`);
    if (startDate) conditions.push(sql`created_at >= ${new Date(startDate)}`);
    if (endDate) conditions.push(sql`created_at <= ${new Date(endDate)}`);

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    // Query audit logs
    const logsResult = await db.execute(sql`
      SELECT * FROM super_admin_audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    // Get total count
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM super_admin_audit_logs
      ${whereClause}
    `);

    return NextResponse.json({
      data: (logsResult as any)?.rows || [],
      total: (countResult as any)?.rows?.[0]?.total ?? 0,
      limit,
      offset,
    });

  } catch (err: any) {
    console.error('[superadmin audit-logs GET]', err);
    return apiError(err);
  }
}

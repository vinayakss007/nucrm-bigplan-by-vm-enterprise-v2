import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedReports, reportExecutions, users } from '@/drizzle/schema';
import { eq, and, or, desc, sql } from 'drizzle-orm';

/**
 * GET /api/tenant/reports/[id]
 * Get saved report details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    const report = await db.select({
      id: savedReports.id,
      tenantId: savedReports.tenantId,
      name: savedReports.name,
      reportType: savedReports.reportType,
      config: savedReports.config,
      chartType: savedReports.chartType,
      isPublic: savedReports.isPublic,
      lastRunAt: savedReports.lastRunAt,
      createdBy: savedReports.createdBy,
      createdAt: savedReports.createdAt,
      updatedAt: savedReports.updatedAt,
      created_by_name: users.fullName
    })
    .from(savedReports)
    .leftJoin(users, eq(users.id, savedReports.createdBy))
    .where(and(
      eq(savedReports.id, id),
      or(eq(savedReports.tenantId, ctx.tenantId), eq(savedReports.isPublic, true))
    ))
    .limit(1);

    if (report.length === 0) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Get recent executions
    const executions = await db.query.reportExecutions.findMany({
      where: eq(reportExecutions.reportId, id),
      orderBy: [desc(reportExecutions.executedAt)],
      limit: 10
    });

    return NextResponse.json({
      data: {
        ...report[0],
        recentExecutions: executions,
      },
    });
  } catch (error: any) {
    console.error('[Report] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/reports/[id]
 * Update saved report
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    
    // Whitelist allowed update fields
    const {
      name,
      config,
      is_public,
      chart_type,
    } = body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (config !== undefined) updateData.config = config;
    if (is_public !== undefined) updateData.isPublic = is_public;
    if (chart_type !== undefined) updateData.chartType = chart_type;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const result = await db.update(savedReports)
      .set({ ...updateData, updatedAt: new Date() })
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Report not found or permission denied' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Report updated',
    });
  } catch (error: any) {
    console.error('[Report] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/reports/[id]
 * Delete saved report
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    const result = await db.delete(savedReports)
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Report not found or permission denied' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Report deleted',
    });
  } catch (error: any) {
    console.error('[Report] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/reports/[id]/run
 * Execute saved report
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { filters = {} } = body;

    // Execute report using database function (keeping sql.raw for DB function call)
    const result = await db.execute(sql`SELECT public.execute_saved_report(${id}, ${ctx.userId}, 'manual', ${JSON.stringify(filters)}) as result`);
    const reportResult = result.rows[0]?.['result'];

    return NextResponse.json({
      ok: true,
      data: reportResult,
    });
  } catch (error: any) {
    console.error('[Report Run] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

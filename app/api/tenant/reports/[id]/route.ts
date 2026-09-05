/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedReports, reportExecutions, users } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/reports/[id]
 * Get saved report details
 */
export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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
      // NOTE: tenant match required even for isPublic reports — a public
      // flag must never expose one tenant's report to another tenant.
      eq(savedReports.tenantId, ctx.tenantId)
    ))
    .limit(1);

    if (report.length === 0) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Get recent executions — scoped to this tenant's report (the report
    // lookup above already enforced the tenant match, so reportId alone
    // cannot leak another tenant's executions).
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'Report GET error', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * PATCH /api/tenant/reports/[id]
 * Update saved report
 */
export const PATCH = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'reports', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);

    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, savedReports, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;
    
    // Whitelist allowed update fields
    const {
      name,
      config,
      is_public,
      chart_type,
    } = body;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'Report PATCH error', requestMethod: 'PATCH' });
    return apiError(error);
  }
});

/**
 * DELETE /api/tenant/reports/[id]
 * Delete saved report
 */
export const DELETE = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'reports', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    const result = await db.update(savedReports)
      .set({ deletedAt: new Date() })
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Report not found or permission denied' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Report deleted',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'Report DELETE error', requestMethod: 'DELETE' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/reports/[id]/run
 * Execute saved report
 */
export const POST = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    const { filters = {} } = body;

    // Execute report using database function (keeping sql.raw for DB function call)
    const result = await db.execute(sql`SELECT public.execute_saved_report(${id}, ${ctx.userId}, 'manual', ${JSON.stringify(filters)}) as result`);
    const reportResult = result.rows[0]?.['result'];

    return NextResponse.json({
      ok: true,
      data: reportResult,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error: error, context: 'Report Run POST error', requestMethod: 'POST' });
    return apiError(error);
  }
});

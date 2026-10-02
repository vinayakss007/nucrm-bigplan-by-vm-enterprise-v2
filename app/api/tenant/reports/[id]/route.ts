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
import { eq, and, desc, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';
import { isUuid } from '@/lib/id';
import { runReportForTenant } from '@/app/api/tenant/reports/run/route';

function invalidReportId(id: string): NextResponse | null {
  return isUuid(id)
    ? null
    : NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
}

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
    // A path segment that is not a uuid used to reach Postgres, which answers
    // `invalid input syntax for type uuid` and the route returned 500. That made
    // /api/tenant/reports/usage — a URL a typo or a stale bookmark produces —
    // look like an outage.
    const badId = invalidReportId(id);
    if (badId) return badId;

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
      eq(savedReports.tenantId, ctx.tenantId),
      // DELETE is a soft delete, so a tombstone is not readable/runnable.
      isNull(savedReports.deletedAt)
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
 
 
  } catch (error) {
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
    // A path segment that is not a uuid used to reach Postgres, which answers
    // `invalid input syntax for type uuid` and the route returned 500. That made
    // /api/tenant/reports/usage — a URL a typo or a stale bookmark produces —
    // look like an outage.
    const badId = invalidReportId(id);
    if (badId) return badId;
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

 
 
    const updateData: Partial<typeof savedReports.$inferInsert> = {};
    if (name !== undefined) updateData.name = name;
    if (config !== undefined) updateData.config = config;
    if (is_public !== undefined) updateData.isPublic = is_public;
    if (chart_type !== undefined) updateData.chartType = chart_type;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const result = await db.update(savedReports)
      .set({ ...updateData, updatedAt: new Date() })
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId), isNull(savedReports.deletedAt)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Report not found or permission denied' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Report updated',
    });
 
 
  } catch (error) {
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
    // A path segment that is not a uuid used to reach Postgres, which answers
    // `invalid input syntax for type uuid` and the route returned 500. That made
    // /api/tenant/reports/usage — a URL a typo or a stale bookmark produces —
    // look like an outage.
    const badId = invalidReportId(id);
    if (badId) return badId;

    const result = await db.update(savedReports)
      .set({ deletedAt: new Date() })
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId), isNull(savedReports.deletedAt)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Report not found or permission denied' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Report deleted',
    });
 
 
  } catch (error) {
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
    // A path segment that is not a uuid used to reach Postgres, which answers
    // `invalid input syntax for type uuid` and the route returned 500. That made
    // /api/tenant/reports/usage — a URL a typo or a stale bookmark produces —
    // look like an outage.
    const badId = invalidReportId(id);
    if (badId) return badId;
    const body = await readJsonBody(request);

    const [report] = await db
      .select({ reportType: savedReports.reportType, config: savedReports.config })
      .from(savedReports)
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId), isNull(savedReports.deletedAt)))
      .limit(1);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // This used to call `public.execute_saved_report`, a plpgsql stub that
    // returned `{rows: [], total: 0}` whatever the data was — so running any
    // saved report looked like a tenant with nothing in it. The stored config
    // supplies the filters and a request may override them.
    const storedFilters = (report.config as { filters?: Record<string, unknown> } | null)?.filters;
    const result = await runReportForTenant(ctx.tenantId, {
      report_type: report.reportType,
      filters: body.filters ?? storedFilters ?? {},
      limit: body.limit,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await db.update(savedReports)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, ctx.tenantId)));

    // The stub recorded nothing either, which is why the report's execution
    // history was always empty rather than merely short.
    await db.insert(reportExecutions).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      reportId: id,
      status: 'completed',
      resultCount: result.rows.length,
    });

    return NextResponse.json({
      ok: true,
      data: { rows: result.rows, total: result.rows.length, page: 1 },
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Report Run POST error', requestMethod: 'POST' });
    return apiError(error);
  }
});

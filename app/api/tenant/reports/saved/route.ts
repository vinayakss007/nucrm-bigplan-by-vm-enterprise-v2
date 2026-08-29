/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Saved Reports List API
 * GET /api/tenant/reports/saved
 * Returns all saved reports for the current tenant
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedReports, users } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const reports = await db.select({
      id: savedReports.id,
      name: savedReports.name,
      reportType: savedReports.reportType,
      chartType: savedReports.chartType,
      isPublic: savedReports.isPublic,
      lastRunAt: savedReports.lastRunAt,
      createdBy: savedReports.createdBy,
      createdAt: savedReports.createdAt,
      updatedAt: savedReports.updatedAt,
      createdByName: users.fullName,
    })
      .from(savedReports)
      .leftJoin(users, eq(users.id, savedReports.createdBy))
      .where(eq(savedReports.tenantId, ctx.tenantId))
      .orderBy(desc(savedReports.updatedAt));

    return NextResponse.json({ data: reports });
  } catch (err) {
    console.error('[reports saved GET]', err);
    return apiError(err);
  }
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Saved Reports List API
 * GET  /api/tenant/reports/saved — every saved report for this tenant
 * POST /api/tenant/reports/saved — create one
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedReports, users } from '@/drizzle/schema';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { z } from 'zod';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { REPORT_TYPES } from '@/app/api/tenant/reports/run/route';

const newReportSchema = z.object({
  name: z.string().trim().min(1).max(200),
  report_type: z.enum(REPORT_TYPES as [string, ...string[]]),
  config: z.record(z.string(), z.unknown()).default({}),
  chart_type: z.string().trim().min(1).max(40).default('table'),
  is_public: z.boolean().default(false),
});

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
      // DELETE is a soft delete (deletedAt), so every read has to exclude the
      // tombstone or a "deleted" report keeps showing up in the list forever.
      .where(and(eq(savedReports.tenantId, ctx.tenantId), isNull(savedReports.deletedAt)))
      .orderBy(desc(savedReports.updatedAt));

    return NextResponse.json({ data: reports });
  } catch (err) {
    await logError({ error: err, context: 'reports saved GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

/**
 * POST /api/tenant/reports/saved
 *
 * The Saved Reports page lists `saved_reports` and offers Run / Edit / Delete
 * against `/api/tenant/reports/[id]`, but nothing in the app ever inserted a
 * row there — the Custom Reports page keeps its reports in a platform_settings
 * blob instead. So the page could only ever render an empty list, and every
 * `[id]` route could only 404. This is the create path it was missing.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'reports', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.create')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const parsed = validateBody(newReportSchema, await readJsonBody(request));
    if (parsed instanceof NextResponse) return parsed;
    const { name, report_type, config, chart_type, is_public } = parsed.data;

    const [created] = await db.insert(savedReports).values({
      tenantId: ctx.tenantId,
      name,
      reportType: report_type,
      config,
      chartType: chart_type,
      isPublic: is_public,
      createdBy: ctx.userId,
    }).returning();

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    await logError({ error: err, context: 'reports saved POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

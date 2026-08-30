/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { complianceRequests } from '@/drizzle/schema/compliance';
import { eq, and, desc } from 'drizzle-orm';
import { generateSOC2Report } from '@/lib/compliance/soc2';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const reports = await db
      .select()
      .from(complianceRequests)
      .where(
        and(
          eq(complianceRequests.tenantId, ctx.tenantId),
          eq(complianceRequests.type, 'soc2_report')
        )
      )
      .orderBy(desc(complianceRequests.createdAt))
      .limit(50);

    return NextResponse.json({ data: reports });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    let body;
    try { body = await readJsonBody(req); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const periodDays = body.periodDays || 90;

    // Create the compliance request record
    const [request] = await db.insert(complianceRequests).values({
      tenantId: ctx.tenantId,
      type: 'soc2_report',
      status: 'processing',
      requestedBy: ctx.userId,
      metadata: { periodDays },
    }).returning();

    // Generate the report
    let report;
    try {
      report = await generateSOC2Report(ctx.tenantId, periodDays);

      await db.update(complianceRequests)
        .set({
          status: 'completed',
          completedAt: new Date(),
          result: report as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(complianceRequests.id, request!.id));
 
 
 
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await logError({ error: err, context: 'compliance/soc2 POST', requestMethod: 'POST' });
      await db.update(complianceRequests)
        .set({
          status: 'failed',
          errorMessage: msg,
          updatedAt: new Date(),
        })
        .where(eq(complianceRequests.id, request!.id));

      return NextResponse.json({ error: 'Report generation failed' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        requestId: request!.id,
        type: 'soc2_report',
        status: 'completed',
        report,
      },
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

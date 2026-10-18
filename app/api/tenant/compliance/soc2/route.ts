/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { complianceRequests } from '@/drizzle/schema/compliance';
import { eq, and, desc } from 'drizzle-orm';
import { generateSOC2Report } from '@/lib/compliance/soc2';
import {
  markRequestCompleted,
  markRequestFailed,
  reapStaleProcessing,
} from '@/lib/compliance/request-lifecycle';
import { reapStaleProcessingRequests } from '@/lib/compliance/stale-requests';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    // #2530: same reap as the GDPR route — an interrupted generation left
    // the row permanently `processing` (lower severity here: the middle step
    // is read-only, so the outcome was a stuck job, not half-applied data).
    await reapStaleProcessingRequests(ctx.tenantId, ['soc2_report']);

    const rawReports = await db
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

    // A `processing` row older than the deadline is abandoned, not in flight:
    // the console must not say forever that a report is still being built.
    // #2530 (part 2).
    const { rows: reports } = await reapStaleProcessing({
      rows: rawReports,
      tenantId: ctx.tenantId,
    });

    return NextResponse.json({ data: reports });
 
 
  } catch (err) { return apiError(err); }
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
      // The terminal marker is deliberately NOT here: it used to sit inside this
      // `try`, whose `catch` writes `failed`, so a report that finished building
      // and whose marker write then threw was recorded as `failed`.
      // #2530 (part 2).
 
 
 
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      void logError({ error: err, context: 'tenant/compliance/soc2 request processing' });
      // Best-effort: if this write also fails, the row stays `processing` and the
      // next read reaps it. Either way the caller is told the work failed.
      await markRequestFailed(request!.id, ctx.tenantId, msg);

      return NextResponse.json({ error: 'Report generation failed' }, { status: 500 });
    }

    const recorded = await markRequestCompleted(
      request!.id,
      ctx.tenantId,
      report as unknown as Record<string, unknown>,
    );

    return NextResponse.json({
      data: {
        requestId: request!.id,
        type: 'soc2_report',
        status: 'completed',
        // What the request did, kept separate from whether the log could take it.
        recordUpdateFailed: !recorded,
        report,
      },
    }, { status: 201 });
 
 
  } catch (err) { return apiError(err); }
});

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { complianceRequests } from '@/drizzle/schema/compliance';
import { eq, and, desc } from 'drizzle-orm';
import { generateSOC2Report } from '@/lib/compliance/soc2';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
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
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
    if (moduleGate) return moduleGate;

    const body = await req.json().catch(e => { console.error('[json] parse error:', e); return {}; });
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
          result: report as any,
        })
        .where(eq(complianceRequests.id, request!.id));
    } catch (err: any) {
      await db.update(complianceRequests)
        .set({
          status: 'failed',
          errorMessage: err.message,
        })
        .where(eq(complianceRequests.id, request!.id));

      return NextResponse.json({ error: 'Report generation failed', detail: err.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        requestId: request!.id,
        type: 'soc2_report',
        status: 'completed',
        report,
      },
    }, { status: 201 });
  } catch (err: any) { return apiError(err); }
}

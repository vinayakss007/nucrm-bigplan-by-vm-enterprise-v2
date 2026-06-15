import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { complianceRequests } from '@/drizzle/schema/compliance';
import { eq, and, desc } from 'drizzle-orm';
import { exportTenantData } from '@/lib/compliance/gdpr';
import { anonymizeTenantData } from '@/lib/compliance/gdpr';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
    if (moduleGate) return moduleGate;

    const requests = await db
      .select()
      .from(complianceRequests)
      .where(
        and(
          eq(complianceRequests.tenantId, ctx.tenantId),
          eq(complianceRequests.type, 'gdpr_export')
        )
      )
      .orderBy(desc(complianceRequests.createdAt))
      .limit(50);

    // Also include gdpr_delete requests
    const deleteRequests = await db
      .select()
      .from(complianceRequests)
      .where(
        and(
          eq(complianceRequests.tenantId, ctx.tenantId),
          eq(complianceRequests.type, 'gdpr_delete')
        )
      )
      .orderBy(desc(complianceRequests.createdAt))
      .limit(50);

    return NextResponse.json({
      data: {
        exports: requests,
        deletions: deleteRequests,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const requestType = body.type as string;

    if (!requestType || !['export', 'delete'].includes(requestType)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be "export" or "delete".' },
        { status: 400 }
      );
    }

    const complianceType = requestType === 'export' ? 'gdpr_export' : 'gdpr_delete';

    // Create the compliance request record
    const [request] = await db.insert(complianceRequests).values({
      tenantId: ctx.tenantId,
      type: complianceType,
      status: 'processing',
      requestedBy: ctx.userId,
      metadata: { initiatedBy: ctx.userId, reason: body.reason || null },
    }).returning();

    // Process the request
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    try {
      if (requestType === 'export') {
        result = await exportTenantData(ctx.tenantId);
      } else {
        result = await anonymizeTenantData(ctx.tenantId);
      }

      // Mark as completed
      await db.update(complianceRequests)
        .set({
          status: 'completed',
          completedAt: new Date(),
          result: { summary: result.metadata || result.categories || {} },
        })
        .where(eq(complianceRequests.id, request!.id));
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[compliance/gdpr]', msg);
      await db.update(complianceRequests)
        .set({
          status: 'failed',
          errorMessage: msg,
        })
        .where(eq(complianceRequests.id, request!.id));

      return NextResponse.json({ error: 'Request processing failed' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        requestId: request!.id,
        type: complianceType,
        status: 'completed',
        result,
      },
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

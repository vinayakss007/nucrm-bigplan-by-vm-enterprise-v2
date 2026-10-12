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
import { exportTenantData, type GDPRExportData, type GDPRDeletionResult } from '@/lib/compliance/gdpr';
import { anonymizeTenantData } from '@/lib/compliance/gdpr';
import {
  markRequestCompleted,
  markRequestFailed,
  reapStaleProcessing,
} from '@/lib/compliance/request-lifecycle';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
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

    // A `processing` row older than the deadline is abandoned, not in flight:
    // report it as failed rather than letting the console claim forever that an
    // erasure is running. #2530 (part 2).
    const { rows: exports } = await reapStaleProcessing({
      rows: requests,
      tenantId: ctx.tenantId,
    });
    const { rows: deletions } = await reapStaleProcessing({
      rows: deleteRequests,
      tenantId: ctx.tenantId,
    });

    return NextResponse.json({
      data: {
        exports,
        deletions,
      },
    });
 
 
  } catch (err) { return apiError(err); }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const body = await readJsonBody(req);
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
 
 
    let result: GDPRExportData | GDPRDeletionResult;
    try {
      if (requestType === 'export') {
        result = await exportTenantData(ctx.tenantId);
      } else {
        result = await anonymizeTenantData(ctx.tenantId);
      }
      // The terminal marker is deliberately NOT here. It used to sit inside this
      // `try`, whose `catch` writes `failed`, so a request whose erasure ran and
      // whose marker write then threw was recorded as `failed` — a compliance log
      // claiming an Article 17 erasure had NOT happened, when it had.
      // #2530 (part 2).
 
 
 
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      void logError({ error: err, context: 'tenant/compliance/gdpr request processing' });
      // Best-effort: if this write also fails, the row stays `processing` and the
      // next read reaps it. Either way the caller is told the work failed.
      await markRequestFailed(request!.id, ctx.tenantId, msg);

      return NextResponse.json({ error: 'Request processing failed' }, { status: 500 });
    }

    const recorded = await markRequestCompleted(request!.id, ctx.tenantId, {
      summary: ('metadata' in result ? result.metadata : undefined) || result.categories || {},
    });

    return NextResponse.json({
      data: {
        requestId: request!.id,
        type: complianceType,
        status: 'completed',
        // What the request did, kept separate from whether the log could take it.
        recordUpdateFailed: !recorded,
        result,
      },
    }, { status: 201 });
 
 
  } catch (err) { return apiError(err); }
});

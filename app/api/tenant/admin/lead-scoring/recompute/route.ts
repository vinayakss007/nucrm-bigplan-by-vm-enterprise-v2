/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Lead Scoring Recompute (admin only)
 *   POST /api/tenant/admin/lead-scoring/recompute
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { recomputeAllLeads } from '@/lib/ai/lead-scoring';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await rateLimitMutating(req, 'aiTemplates', 'post');
    if (limited) return limited;

    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const result = await recomputeAllLeads(ctx.tenantId, ctx.userId);
    
    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'recompute_lead_scores', entityType: 'lead',
      newData: { count: result.count },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
});

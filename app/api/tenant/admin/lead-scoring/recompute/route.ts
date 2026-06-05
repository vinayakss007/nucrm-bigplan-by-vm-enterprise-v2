/**
 * Lead Scoring Recompute (admin only)
 *   POST /api/tenant/admin/lead-scoring/recompute
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { recomputeAllLeads } from '@/lib/ai/lead-scoring';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
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
}

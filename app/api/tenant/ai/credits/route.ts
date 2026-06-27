/**
 * Tenant AI Credits — balance & usage.
 * GET /api/tenant/ai/credits
 *
 * Returns the tenant's current credit balance and recent usage.
 * Read-only for tenant users.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { getCreditBalance, getCreditHistory } from '@/lib/ai/credits';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_activity_log');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20');

    const balance = await getCreditBalance(ctx.tenantId);
    const history = await getCreditHistory(ctx.tenantId, limit);

    return NextResponse.json({
      success: true,
      data: { balance, history },
    });
  } catch (err: unknown) {
    console.error('[api/tenant/ai/credits] GET error:', (err as Error).message);
    return apiError(err);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { withApiRoute } from '@/lib/api/with-api-route';
import { parseLimitOffset } from '@/lib/api/query-params';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_activity_log');
    if (gate) return gate;

    // #1612: clamp `limit` to [1, 200] with a default of 20 so `?limit=100000`
    // can't dump the whole credits ledger (memory/DoS) and `?limit=0`/negative
    // can't produce an invalid query.
    const { limit } = parseLimitOffset(req, { defaultLimit: 20 });

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
});

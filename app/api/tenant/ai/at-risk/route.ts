/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * At-Risk Deals API
 * 
 * Returns deals flagged as 'at-risk' based on tenant-defined rules.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { getAtRiskDeals } from '@/lib/ai/at-risk';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_at_risk');
    if (gate) return gate;

    const atRiskDeals = await getAtRiskDeals(ctx.tenantId);

    return NextResponse.json({
      data: atRiskDeals,
      count: atRiskDeals.length
    });
  } catch (error) {
    return apiError(error);
  }
});

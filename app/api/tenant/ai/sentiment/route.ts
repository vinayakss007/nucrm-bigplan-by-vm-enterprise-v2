/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * POST /api/tenant/ai/sentiment — Analyze text sentiment with AI
 * GET  /api/tenant/ai/sentiment — Get recent sentiment analyses
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { analyzeSentiment, updateDealSentiment } from '@/lib/ai/sentiment';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { checkRateLimit } from '@/lib/rate-limit';

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_sentiment');
    if (gate) return gate;

    const limited = await checkRateLimit(req, { action: 'ai_sentiment', max: 30, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(req);
    const { text, deal_id } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const result = await analyzeSentiment(text, ctx.tenantId, ctx.userId);

    if (deal_id) {
      await updateDealSentiment(deal_id, ctx.tenantId, result);
    }

    return NextResponse.json({ success: true, data: result });
  } catch (err: unknown) {
    void logError({ error: err, context: 'tenant/ai/sentiment POST' });
    return apiError(err);
  }
});

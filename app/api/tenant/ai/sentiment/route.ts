/**
 * POST /api/tenant/ai/sentiment — Analyze text sentiment with AI
 * GET  /api/tenant/ai/sentiment — Get recent sentiment analyses
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { analyzeSentiment, updateDealSentiment } from '@/lib/ai/sentiment';
import { requireAiFeature } from '@/lib/ai/plan-gate';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_sentiment');
    if (gate) return gate;

    const body = await req.json();
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
    console.error('[api/ai/sentiment] POST error:', (err as Error).message);
    return apiError(err);
  }
}

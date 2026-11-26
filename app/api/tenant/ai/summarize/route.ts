/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantModules } from '@/drizzle/schema/modules';
import { eq, and } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { GatewayError } from '@/lib/ai/gateway';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { summarizeEntity } from '@/lib/ai/summarize';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { z } from 'zod';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    // #3402 — role gate before the plan gate and the provider call.
    const denied = requirePerm(ctx, 'ai.use');
    if (denied) return denied;

    const gate = await requireAiFeature(ctx, 'ai_summarize');
    if (gate) return gate;

    const limited = await checkRateLimit(req, { action: 'ai_summarize', max: 30, windowMinutes: 60 });
    if (limited) return limited;

    const moduleInstalled = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, ctx.tenantId),
        eq(tenantModules.moduleId, 'ai-assistant'),
        eq(tenantModules.status, 'active'),
      ),
    });
    if (!moduleInstalled) {
      return NextResponse.json({
        error: 'AI Assistant module not installed. Install it from Settings → Modules.',
      }, { status: 403 });
    }

    const parsed = validateBody(z.object({
      entity_type: z.enum(['contact', 'deal', 'company']),
      entity_id: z.string().min(8),
      custom_instructions: z.string().max(2000).optional(),
    }), await readJsonBody(req));
    if (parsed instanceof NextResponse) return parsed;
    const { entity_type, entity_id, custom_instructions } = parsed.data;

    let result;
    try {
      result = await summarizeEntity(
        ctx.tenantId,
        ctx.userId,
        entity_type,
        entity_id,
        custom_instructions,
      );
    } catch (err) {
      if (err instanceof GatewayError) {
        const status = err.code === 'no_provider_enabled' || err.code === 'no_key_for_provider' ? 503 : 502;
        return NextResponse.json({ error: err.message, code: err.code }, { status });
      }
      throw err;
    }

    return NextResponse.json(result);
  } catch (err) {
    void logError({ error: err, context: 'tenant/ai/summarize POST' });
    return apiError(err);
  }
});

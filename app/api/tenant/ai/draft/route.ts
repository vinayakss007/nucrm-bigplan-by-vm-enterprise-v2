/**
 * POST /api/tenant/ai/draft
 *
 * Generate an Auto-Draft via the Phase 5 gateway, hydrated with context
 * from the entity the rep picked.
 *
 *   body: {
 *     template_id?: string,       — saved row
 *     template_slug?: string,     — seed template
 *     entity_type:  'contact' | 'deal' | 'company',
 *     entity_id:    uuid,
 *     custom_instructions?: string,
 *   }
 *
 * Returns:
 *   {
 *     subject?: string,
 *     body: string,
 *     provider, model, tokens_used, latency_ms, fallbacks_used, activity_id
 *   }
 *
 * Module-gated on `ai-assistant`. Rate-limited 30/hr (same as the AI hub
 * actions). All accounting goes through gateway.chat() which writes the
 * ai_activity row, so this endpoint stays thin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { aiDraftTemplates } from '@/drizzle/schema/ai';
import { tenantModules } from '@/drizzle/schema/modules';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { chat, GatewayError } from '@/lib/ai/gateway';
import {
  hydrateDraftContext,
  interpolate,
  SEED_DRAFT_TEMPLATES,
  type EntityType,
} from '@/lib/ai/draft';

interface PostBody {
  template_id?: string;
  template_slug?: string;
  entity_type?: string;
  entity_id?: string;
  custom_instructions?: string;
}

function isEntityType(s: unknown): s is EntityType {
  return s === 'contact' || s === 'deal' || s === 'company' || s === 'lead' || s === 'ticket';
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(req, { action: 'ai_draft', max: 30, windowMinutes: 60 });
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

    const body = (await req.json().catch(e => { console.error('[json] parse error:', e); return {}; })) as PostBody;
    if (!isEntityType(body.entity_type)) {
      return NextResponse.json({ error: 'entity_type must be contact, deal, company, lead or ticket' }, { status: 400 });
    }
    if (typeof body.entity_id !== 'string' || body.entity_id.length < 8) {
      return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
    }

    // Resolve the template — DB row, then seed, then a "no-template" generic fallback.
    let systemPrompt = '';
    let userPrompt = '';
    let kind = 'email';
    let defaultSubject: string | null = null;
    let templateLabel = 'no-template';

    if (body.template_id) {
      const row = await db.query.aiDraftTemplates.findFirst({
        where: and(
          eq(aiDraftTemplates.id, body.template_id),
          eq(aiDraftTemplates.tenantId, ctx.tenantId),
          isNull(aiDraftTemplates.deletedAt),
        ),
      });
      if (!row || !row.active) return NextResponse.json({ error: 'Template not found or disabled' }, { status: 404 });
      systemPrompt = row.systemPrompt;
      userPrompt = row.userPrompt;
      kind = row.kind ?? 'email';
      defaultSubject = row.defaultSubject ?? null;
      templateLabel = row.slug;
    } else if (body.template_slug) {
      const seed = SEED_DRAFT_TEMPLATES.find(s => s.slug === body.template_slug);
      if (!seed) return NextResponse.json({ error: 'Unknown seed slug' }, { status: 404 });
      systemPrompt = seed.systemPrompt;
      userPrompt = seed.userPrompt;
      kind = seed.kind;
      defaultSubject = seed.defaultSubject ?? null;
      templateLabel = seed.slug;
    } else {
      // Generic fallback so /tenant/ai/draft works even before any templates exist
      systemPrompt = 'You are a sales rep writing a short professional email under 120 words. Output only the email body.';
      userPrompt = 'Write a follow-up email to {{contact.first_name}} {{contact.last_name}} at {{company.name}}.';
    }

    // Hydrate + interpolate
    const draftCtx = await hydrateDraftContext(ctx.tenantId, ctx.userId, {
      entityType: body.entity_type,
      entityId: body.entity_id,
    });

    const sys = interpolate(systemPrompt, draftCtx);
    const user = interpolate(
      userPrompt + (body.custom_instructions ? `\n\nAdditional instructions: ${String(body.custom_instructions).slice(0, 500)}` : ''),
      draftCtx,
    );
    const subjectInterpolated = defaultSubject ? interpolate(defaultSubject, draftCtx) : null;

    let resp;
    try {
      resp = await chat({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'draft',
        system: sys,
        messages: [{ role: 'user', content: user }],
        entityType: body.entity_type,
        entityId: body.entity_id,
        metadata: { template: templateLabel, kind },
      });
    } catch (err) {
      if (err instanceof GatewayError) {
        const status = err.code === 'no_provider_enabled' || err.code === 'no_key_for_provider' ? 503 : 502;
        return NextResponse.json({ error: "Internal server error", code: err.code }, { status });
      }
      throw err;
    }

    return NextResponse.json({
      kind,
      subject: subjectInterpolated,
      body: resp.text,
      provider: resp.provider,
      model: resp.model,
      tokens_used: resp.tokensIn + resp.tokensOut,
      latency_ms: resp.latencyMs,
      fallbacks_used: resp.fallbacksUsed,
      activity_id: resp.activityId,
      template: templateLabel,
    });
  } catch (err) {
    console.error('[ai/draft POST]', err);
    return apiError(err);
  }
}

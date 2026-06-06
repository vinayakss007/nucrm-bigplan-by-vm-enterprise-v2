/**
 * AI Assistant API — multi-provider gateway.
 *
 * Actions: draft_email, score_lead, predict_deal, suggest_followup
 *
 * Replaces the previous direct call to Anthropic. The actual provider call
 * goes through `lib/ai/gateway.ts` which handles provider selection, fallback
 * chain, and per-attempt logging into `ai_activity`.
 *
 * Still gates on:
 *   • `ai-assistant` module installed for the tenant
 *   • `checkTokenAndLimits()` — platform/tenant/user budgets (lib/ai/common.ts)
 *   • per-IP rate limit (30/hour)
 *
 * After a successful call we still call `recordUsage()` so the existing
 * token-budget machinery (apiKeysRegistry, tokenBudgets, aiUsageAggregated,
 * aiUsageLogs) keeps working alongside the new ai_activity log.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { aiAssistantSchema } from '@/lib/api/schemas';
import { requireAuth, requireModule } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantModules } from '@/drizzle/schema/modules';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkTokenAndLimits, recordUsage } from '@/lib/ai/common';
import { logError } from '@/lib/errors';
import { chat, GatewayError, type GatewayRequest } from '@/lib/ai/gateway';

// FIX HIGH-03: Sanitize inputs to prevent prompt injection
function sanitizeInput(input: string, maxLength: number = 500): string {
  if (!input) return '';
  return String(input)
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/(ignore previous|system prompt|you are now|disregard)/gi, '[FILTERED]')
    .trim();
}

/**
 * Map a tenant action to the metric module name used by lib/ai/common.ts.
 * Different actions count against different per-tenant monthly limits.
 */
function moduleForAction(action: string): string {
  switch (action) {
    case 'score_lead':       return 'lead_scoring';
    case 'predict_deal':     return 'revenue_agent';
    case 'draft_email':
    case 'suggest_followup':
    default:                 return 'ai-assistant';
  }
}

/** Map gateway action label written to ai_activity. */
function activityActionFor(action: string): string {
  switch (action) {
    case 'draft_email':      return 'draft';
    case 'score_lead':       return 'lead_scoring';
    case 'predict_deal':     return 'predict_deal';
    case 'suggest_followup': return 'suggest_followup';
    default:                 return action;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    // Rate limit: 30 AI calls per hour
    const limited = await checkRateLimit(req, { action: 'ai_assistant', max: 30, windowMinutes: 60 });
    if (limited) return limited;

    // Module gate — uniform check across all AI/automation/forms/etc. routes
    const denied = await requireModule(ctx, 'ai-assistant');
    if (denied) return denied;

    // Pull module settings (separate from the gate so requireModule stays generic)
    const moduleInstalled = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, ctx.tenantId),
        eq(tenantModules.moduleId, 'ai-assistant'),
        eq(tenantModules.status, 'active'),
      ),
    });
    if (!moduleInstalled) {
      return NextResponse.json(
        { error: 'AI Assistant module not installed. Install it from Settings → Modules.' },
        { status: 403 },
      );
    }

    // Use tenant's API key or fall back to platform key
    const tenantKey = (moduleInstalled?.settings as any)?.anthropic_api_key;
    const apiKey = tenantKey || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      return NextResponse.json({ error: 'No Anthropic API key configured. Add one in the AI Assistant module settings.' }, { status: 503 });
    }

    const rawBody = await req.json();
    const validated = validateBody(aiAssistantSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { action, contact, deal, context } = v;

    // Sanitise everything before it gets near a prompt
    const sanitizedContact = contact ? {
      ...contact,
      first_name: sanitizeInput(contact.first_name ?? '', 100),
      last_name: sanitizeInput(contact.last_name ?? '', 100),
      company_name: sanitizeInput(contact.company_name ?? '', 200),
      lead_status: sanitizeInput(contact.lead_status ?? '', 50),
      notes: sanitizeInput(contact.notes ?? '', 300),
      tags: Array.isArray(contact.tags) ? contact.tags.slice(0, 20).map((t: string) => sanitizeInput(t, 50)) : [],
    } : null;

    const sanitizedDeal = deal ? {
      ...deal,
      title: sanitizeInput(deal.title ?? '', 200),
      stage: sanitizeInput(deal.stage ?? '', 50),
      first_name: sanitizeInput(deal.first_name ?? '', 100),
      last_name: sanitizeInput(deal.last_name ?? '', 100),
      close_date: sanitizeInput(deal.close_date ?? '', 50),
    } : null;

    const sanitizedContext = sanitizeInput(context ?? '', 500);

    // Token-budget gate (platform / tenant / user). Service is "ai" since the
    // actual provider is decided inside the gateway via the fallback chain.
    const estimatedCostCents = parseInt(process.env['AI_ESTIMATED_COST_CENTS'] || '50');
    const moduleName = moduleForAction(action);
    const tokenCheck = await checkTokenAndLimits(
      ctx.tenantId,
      ctx.userId,
      moduleName,
      'ai',
      estimatedCostCents,
    );
    if (!tokenCheck.allowed) {
      return NextResponse.json({
        error: `AI usage limit exceeded: ${tokenCheck.reason}`,
        remaining: tokenCheck.remaining,
      }, { status: 429 });
    }

    // Build the prompt for the requested action
    let system: string;
    let user: string;
    switch (action) {
      case 'draft_email':
        system = `You are a sales assistant. Write professional, concise sales emails. Always use the contact's first name. Keep emails under 150 words. Output only the email body text, no subject line.`;
        user = `Write a follow-up email to ${sanitizedContact?.first_name ?? 'the contact'} at ${sanitizedContact?.company_name ?? 'their company'}.
Their status: ${sanitizedContact?.lead_status ?? 'unknown'}.
Context: ${sanitizedContext || 'General follow-up'}.
Tone: Professional but warm.`;
        break;

      case 'score_lead':
        system = `You are a lead scoring expert. Score leads 0-100 based on their profile. Return ONLY a JSON object: { "score": number, "reason": "short explanation", "next_action": "what to do next" }`;
        user = `Score this lead:
Name: ${sanitizedContact?.first_name ?? ''} ${sanitizedContact?.last_name ?? ''}
Company: ${sanitizedContact?.company_name ?? 'Unknown'}
Status: ${sanitizedContact?.lead_status ?? ''}
Score so far: ${sanitizedContact?.score ?? 0}
Tags: ${(sanitizedContact?.tags ?? []).join(', ') || 'none'}
Notes: ${sanitizedContact?.notes?.slice(0, 200) || 'none'}`;
        break;

      case 'predict_deal':
        system = `You are a sales analyst. Predict deal outcomes based on pipeline data. Return ONLY JSON: { "win_probability": number (0-100), "estimated_close": "timeframe", "risk_factors": ["factor1"], "recommendations": ["action1"] }`;
        user = `Analyze this deal:
Title: ${sanitizedDeal?.title ?? ''}
Value: $${sanitizedDeal?.value ?? 0}
Stage: ${sanitizedDeal?.stage ?? ''}
Current probability: ${sanitizedDeal?.probability ?? 0}%
Close date: ${sanitizedDeal?.close_date || 'not set'}
Contact: ${sanitizedDeal?.first_name ?? ''} ${sanitizedDeal?.last_name ?? ''}
Days in stage: unknown`;
        break;

      case 'suggest_followup':
        system = `You are a CRM advisor. Suggest the best next action for a sales rep. Be specific and actionable. Return ONLY JSON: { "action": "what to do", "timing": "when", "channel": "email/call/meeting", "script": "what to say" }`;
        user = `Contact: ${sanitizedContact?.first_name ?? ''} ${sanitizedContact?.last_name ?? ''} at ${sanitizedContact?.company_name ?? 'their company'}
Status: ${sanitizedContact?.lead_status ?? ''}
Last activity: ${sanitizedContext || 'Unknown'}
Score: ${sanitizedContact?.score ?? 0}/100`;
        break;

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Send through the gateway
    const gatewayReq: GatewayRequest = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: activityActionFor(action),
      system,
      messages: [{ role: 'user', content: user }],
      metadata: { module: moduleName },
    };

    let resp;
    try {
      resp = await chat(gatewayReq);
    } catch (err) {
      if (err instanceof GatewayError) {
        if (err.code === 'no_provider_enabled') {
          return NextResponse.json({
            error: 'No AI provider is enabled. Configure one at Settings → AI Providers.',
            code: err.code,
          }, { status: 503 });
        }
        if (err.code === 'no_key_for_provider') {
          return NextResponse.json({
            error: `No API key stored for ${err.provider ?? 'the requested provider'}.`,
            code: err.code,
          }, { status: 503 });
        }
        return apiError(err, "Internal server error", 502);
      }
      throw err;
    }

    // Update existing token-budget books (apiKeysRegistry, tokenBudgets, aiUsageAggregated, aiUsageLogs)
    const tokensUsed = resp.tokensIn + resp.tokensOut;
    // Approximate cost was already computed inside the gateway and written to ai_activity;
    // we re-estimate here only for the legacy bookkeeping path which keys on `service`.
    const actualCostCents = Math.round(tokensUsed * 0.001);
    try {
      await recordUsage(
        ctx.tenantId,
        ctx.userId,
        moduleName,
        resp.provider,
        actualCostCents,
        tokensUsed,
        { action, gateway_activity_id: resp.activityId, fallbacks_used: resp.fallbacksUsed },
      );
    } catch (err) {
      // Bookkeeping failure must not break the user response
      logError({ error: err, context: 'ai-assistant-recordUsage' }).catch(() => {});
    }

    const envelope = {
      action,
      provider: resp.provider,
      model: resp.model,
      usage: {
        input_tokens: resp.tokensIn,
        output_tokens: resp.tokensOut,
        total_tokens: tokensUsed,
        latency_ms: resp.latencyMs,
        fallbacks_used: resp.fallbacksUsed,
      },
      activity_id: resp.activityId,
    };

    // Try to JSON-parse for the structured actions; fall back to a sensible shape.
    if (action === 'draft_email') {
      return NextResponse.json({ ...envelope, result: resp.text });
    }
    if (action === 'score_lead') {
      try {
        return NextResponse.json({ ...envelope, result: JSON.parse(resp.text), raw: resp.text });
      } catch {
        return NextResponse.json({
          ...envelope,
          result: { score: 50, reason: resp.text, next_action: 'Review manually' },
          raw: resp.text,
        });
      }
    }
    if (action === 'predict_deal') {
      try {
        return NextResponse.json({ ...envelope, result: JSON.parse(resp.text) });
      } catch {
        return NextResponse.json({
          ...envelope,
          result: {
            win_probability: deal?.probability ?? 50,
            estimated_close: '30 days',
            risk_factors: [],
            recommendations: [resp.text],
          },
        });
      }
    }
    if (action === 'suggest_followup') {
      try {
        return NextResponse.json({ ...envelope, result: JSON.parse(resp.text) });
      } catch {
        return NextResponse.json({
          ...envelope,
          result: { action: resp.text, timing: 'Today', channel: 'email', script: '' },
        });
      }
    }

    // Unreachable — switch above already handled every value.
    return NextResponse.json({ ...envelope, result: resp.text });
  } catch (err) {
    logError({ error: err, context: 'ai-assistant' }).catch(() => {});
    return apiError(err);
  }
}

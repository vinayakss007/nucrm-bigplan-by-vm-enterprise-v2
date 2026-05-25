/**
 * AI Assistant API — powered by Claude.
 * Actions: draft_email, score_lead, predict_deal, enrich_contact, suggest_followup
 * Requires: ai-assistant module installed for tenant, and ANTHROPIC_API_KEY set.
 *
 * Integrated with token tracking and rate limits from lib/ai/common.ts
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

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// FIX HIGH-03: Sanitize inputs to prevent prompt injection
function sanitizeInput(input: string, maxLength: number = 500): string {
  if (!input) return '';
  // Remove potentially malicious patterns
  return String(input)
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/(ignore previous|system prompt|you are now|disregard)/gi, '[FILTERED]')
    .trim();
}

// FIX MEDIUM-04: Make AI model configurable via env var
const AI_MODEL = process.env['AI_MODEL'] || 'claude-3-5-haiku-20241022';

async function callClaude(systemPrompt: string, userMessage: string, apiKey: string): Promise<{ text: string; usage: any }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return { 
    text: data.content?.[0]?.text ?? '',
    usage: data.usage || {}
  };
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
        eq(tenantModules.status, 'active')
      )
    });

    // Use tenant's API key or fall back to platform key
    const tenantKey = (moduleInstalled?.settings as any)?.anthropic_api_key;
    const apiKey = tenantKey || ANTHROPIC_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'No Anthropic API key configured. Add one in the AI Assistant module settings.' }, { status: 503 });
    }

    const rawBody = await req.json();
    const validated = validateBody(aiAssistantSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { action, contact, deal, context } = v;

    // FIX HIGH-03: Sanitize all user inputs before using in prompts
    const sanitizedContact = contact ? {
      ...contact,
      first_name: sanitizeInput(contact.first_name, 100),
      last_name: sanitizeInput(contact.last_name, 100),
      company_name: sanitizeInput(contact.company_name, 200),
      lead_status: sanitizeInput(contact.lead_status, 50),
      notes: sanitizeInput(contact.notes, 300),
      tags: Array.isArray(contact.tags) ? contact.tags.slice(0, 20).map((t: string) => sanitizeInput(t, 50)) : [],
    } : null;

    const sanitizedDeal = deal ? {
      ...deal,
      title: sanitizeInput(deal.title, 200),
      stage: sanitizeInput(deal.stage, 50),
      first_name: sanitizeInput(deal.first_name, 100),
      last_name: sanitizeInput(deal.last_name, 100),
      close_date: sanitizeInput(deal.close_date, 50),
    } : null;

    const sanitizedContext = sanitizeInput(context, 500);

    // FIX MEDIUM-05: Make AI cost estimation configurable and more realistic
    const estimatedCostCents = parseInt(process.env['AI_ESTIMATED_COST_CENTS'] || '50');
    const tokenCheck = await checkTokenAndLimits(
      ctx.tenantId,
      ctx.userId,
      'ai-assistant',
      'anthropic',
      estimatedCostCents
    );

    if (!tokenCheck.allowed) {
      return NextResponse.json({
        error: `AI usage limit exceeded: ${tokenCheck.reason}`,
        remaining: tokenCheck.remaining
      }, { status: 429 });
    }

    switch (action) {
      case 'draft_email': {
        const result = await callClaude(
          `You are a sales assistant. Write professional, concise sales emails.
           Always use the contact's first name. Keep emails under 150 words.
           Output only the email body text, no subject line.`,
          `Write a follow-up email to ${sanitizedContact?.first_name ?? 'the contact'} at ${sanitizedContact?.company_name ?? 'their company'}.
           Their status: ${sanitizedContact?.lead_status ?? 'unknown'}.
           Context: ${sanitizedContext ?? 'General follow-up'}.
           Tone: Professional but warm.`,
          apiKey
        );
        
        // Record actual usage
        const actualCostCents = Math.round((result.usage.output_tokens || 0) * 0.001); // Approximate cost calculation
        await recordUsage(
          ctx.tenantId,
          ctx.userId,
          'ai-assistant',
          'anthropic',
          actualCostCents,
          result.usage.total_tokens || 0,
          { action, tokensUsed: result.usage }
        );
        
        return NextResponse.json({ result: result.text, action, usage: result.usage });
      }

      case 'score_lead': {
        const result = await callClaude(
          `You are a lead scoring expert. Score leads 0-100 based on their profile.
           Return ONLY a JSON object: { "score": number, "reason": "short explanation", "next_action": "what to do next" }`,
          `Score this lead:
           Name: ${sanitizedContact?.first_name} ${sanitizedContact?.last_name}
           Company: ${sanitizedContact?.company_name ?? 'Unknown'}
           Status: ${sanitizedContact?.lead_status}
           Score so far: ${sanitizedContact?.score ?? 0}
           Tags: ${(sanitizedContact?.tags ?? []).join(', ') || 'none'}
           Notes: ${sanitizedContact?.notes?.slice(0, 200) ?? 'none'}`,
          apiKey
        );
        
        // Record usage
        const actualCostCents = Math.round((result.usage.output_tokens || 0) * 0.001);
        await recordUsage(
          ctx.tenantId,
          ctx.userId,
          'lead_scoring',
          'anthropic',
          actualCostCents,
          result.usage.total_tokens || 0,
          { action, tokensUsed: result.usage }
        );
        
        try {
          const parsed = JSON.parse(result.text);
          return NextResponse.json({ result: parsed, action, raw: result.text, usage: result.usage });
        } catch {
          return NextResponse.json({ result: { score: 50, reason: String(result.text), next_action: 'Review manually' }, action, usage: result.usage });
        }
      }

      case 'predict_deal': {
        const result = await callClaude(
          `You are a sales analyst. Predict deal outcomes based on pipeline data.
           Return ONLY JSON: { "win_probability": number (0-100), "estimated_close": "timeframe", "risk_factors": ["factor1"], "recommendations": ["action1"] }`,
          `Analyze this deal:
           Title: ${sanitizedDeal?.title}
           Value: $${sanitizedDeal?.value ?? 0}
           Stage: ${sanitizedDeal?.stage}
           Current probability: ${sanitizedDeal?.probability ?? 0}%
           Close date: ${sanitizedDeal?.close_date ?? 'not set'}
           Contact: ${sanitizedDeal?.first_name} ${sanitizedDeal?.last_name}
           Days in stage: unknown`,
          apiKey
        );
        
        // Record usage
        const actualCostCents = Math.round((result.usage.output_tokens || 0) * 0.001);
        await recordUsage(
          ctx.tenantId,
          ctx.userId,
          'revenue_agent',
          'anthropic',
          actualCostCents,
          result.usage.total_tokens || 0,
          { action, tokensUsed: result.usage }
        );
        
        try {
          return NextResponse.json({ result: JSON.parse(result.text), action, usage: result.usage });
        } catch {
          return NextResponse.json({ result: { win_probability: deal?.probability ?? 50, estimated_close: '30 days', risk_factors: [], recommendations: [result.text] }, action, usage: result.usage });
        }
      }

      case 'suggest_followup': {
        const result = await callClaude(
          `You are a CRM advisor. Suggest the best next action for a sales rep.
           Be specific and actionable. Return ONLY JSON: { "action": "what to do", "timing": "when", "channel": "email/call/meeting", "script": "what to say" }`,
          `Contact: ${sanitizedContact?.first_name} ${sanitizedContact?.last_name} at ${sanitizedContact?.company_name ?? 'their company'}
           Status: ${sanitizedContact?.lead_status}
           Last activity: ${sanitizedContext ?? 'Unknown'}
           Score: ${sanitizedContact?.score ?? 0}/100`,
          apiKey
        );
        
        // Record usage
        const actualCostCents = Math.round((result.usage.output_tokens || 0) * 0.001);
        await recordUsage(
          ctx.tenantId,
          ctx.userId,
          'ai-assistant',
          'anthropic',
          actualCostCents,
          result.usage.total_tokens || 0,
          { action, tokensUsed: result.usage }
        );
        
        try {
          return NextResponse.json({ result: JSON.parse(result.text), action, usage: result.usage });
        } catch {
          return NextResponse.json({ result: { action: result.text, timing: 'Today', channel: 'email', script: '' }, action, usage: result.usage });
        }
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    logError({ error: err, context: 'ai-assistant' }).catch(()=>{});
    return apiError(err);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailDrafts } from '@/drizzle/schema/comm';
import { contacts } from '@/drizzle/schema';
import { tenantModules } from '@/drizzle/schema/modules';
import { eq, and, desc } from 'drizzle-orm';
import { can } from '@/lib/auth/middleware';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { parseLimitOffset } from '@/lib/api/query-params';
import { checkRateLimit } from '@/lib/rate-limit';
import { chat, GatewayError } from '@/lib/ai/gateway';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { hydrateDraftContext, interpolate, type EntityType } from '@/lib/ai/draft';

/** Human-readable descriptions of each supported purpose, fed to the model. */
const PURPOSE_GUIDANCE: Record<string, string> = {
  follow_up: 'a follow-up email that references prior contact and proposes a concrete next step',
  introduction: 'a cold-but-warm introduction email that opens a relationship and requests a brief conversation',
  check_in: 'a light-touch check-in email to re-engage a contact you have not spoken to recently',
  proposal: 'an email presenting a proposal, summarising value and inviting the recipient to review',
  closing: 'an email that drives a deal to close by laying out clear next steps',
};

const LENGTH_GUIDANCE: Record<string, string> = {
  short: 'Keep it under 60 words.',
  medium: 'Keep it around 100-120 words.',
  long: 'Up to 200 words is fine, but stay focused.',
};

/**
 * POST /api/tenant/ai/email-draft
 *
 * Generate an AI-powered email draft. This calls the real AI gateway
 * (lib/ai/gateway.chat) — which handles provider selection, credit metering,
 * and ai_activity audit logging — using the contact/deal record as context.
 * The generated draft is persisted to comm_email_drafts (so the GET list and
 * any UI continue to work).
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Plan gate + rate limit, mirroring /api/tenant/ai/draft.
    const gate = await requireAiFeature(ctx, 'ai_draft');
    if (gate) return gate;
    const limited = await checkRateLimit(request, { action: 'ai_email_draft', max: 30, windowMinutes: 60 });
    if (limited) return limited;

    // Ensure tenant has the AI Assistant module installed
    const moduleInstalled = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, ctx.tenantId),
        eq(tenantModules.moduleId, 'ai-assistant'),
        eq(tenantModules.status, 'active')
      )
    });
    if (!moduleInstalled) {
      return NextResponse.json({ error: 'AI Assistant module not installed' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const {
      contact_id,
      deal_id,
      purpose,
      tone = 'professional',
      length = 'medium',
      custom_instructions,
    } = body as {
      contact_id?: string;
      deal_id?: string;
      purpose?: string;
      tone?: string;
      length?: string;
      custom_instructions?: string;
    };

    if (!purpose) {
      return NextResponse.json({ error: 'purpose is required' }, { status: 400 });
    }
    if (!contact_id && !deal_id) {
      return NextResponse.json({ error: 'contact_id or deal_id is required' }, { status: 400 });
    }

    // Hydrate real record context via the shared draft helper. Prefer the deal
    // as the context anchor when provided, else the contact.
    const entityType: EntityType = deal_id ? 'deal' : 'contact';
    const entityId = (deal_id || contact_id)!;
    const draftCtx = await hydrateDraftContext(ctx.tenantId, ctx.userId, { entityType, entityId });

    const purposeText = PURPOSE_GUIDANCE[purpose] ?? `a ${purpose.replace(/_/g, ' ')} email`;
    const lengthText = LENGTH_GUIDANCE[length] ?? LENGTH_GUIDANCE['medium'];

    const system = interpolate(
      `You are a sales representative at {{tenant.name}} writing ${purposeText}. ` +
        `Write in a ${tone} tone. ${lengthText} ` +
        `Return the email as two lines: first line "Subject: <subject>", then a blank line, then the body. ` +
        `Do not invent facts that are not supported by the provided context.`,
      draftCtx,
    );
    const user = interpolate(
      `Write the email to {{contact.first_name}} {{contact.last_name}} at {{company.name}}.` +
        (custom_instructions ? `\n\nAdditional instructions: ${String(custom_instructions).slice(0, 500)}` : ''),
      draftCtx,
    );

    let resp;
    try {
      resp = await chat({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'email_draft',
        system,
        messages: [{ role: 'user', content: user }],
        entityType,
        entityId,
        metadata: { purpose, tone, length },
      });
    } catch (err) {
      if (err instanceof GatewayError) {
        const status = err.code === 'no_provider_enabled' || err.code === 'no_key_for_provider' ? 503 : 502;
        return NextResponse.json({ error: 'AI provider unavailable', code: err.code }, { status });
      }
      throw err;
    }

    // Split the model output into subject + body. Falls back gracefully if the
    // model didn't follow the "Subject:" convention.
    const text = resp.text.trim();
    let emailSubject = '';
    let emailBody = text;
    const subjectMatch = text.match(/^\s*subject:\s*(.+)$/im);
    if (subjectMatch) {
      emailSubject = subjectMatch[1]!.trim();
      emailBody = text.slice(subjectMatch.index! + subjectMatch[0].length).trim();
    }
    if (!emailSubject) {
      emailSubject = purpose.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Persist the generated draft.
    const drafts = await db.insert(emailDrafts)
      .values({
        tenantId: ctx.tenantId,
        contactId: contact_id || null,
        dealId: deal_id || null,
        purpose,
        subject: emailSubject,
        body: emailBody,
        tone,
        metadata: { length, ai: true, provider: resp.provider, model: resp.model },
        createdBy: ctx.userId,
      } as typeof emailDrafts.$inferInsert)
      .returning();

    const draft = drafts[0];

    return NextResponse.json({
      ok: true,
      draft,
      subject: emailSubject,
      body: emailBody,
      provider: resp.provider,
      model: resp.model,
      tokens_used: resp.tokensIn + resp.tokensOut,
      activity_id: resp.activityId,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Email Draft] POST error:', error);
    return apiError(error);
  }
});

/**
 * GET /api/tenant/ai/email-drafts
 * Get email drafts
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const contact_id = searchParams.get('contact_id');
    const deal_id = searchParams.get('deal_id');
    // #1612: clamp `limit` to [1, 200] with a default of 20 so `?limit=100000`
    // can't dump every email draft (memory/DoS) and `?limit=0`/negative can't
    // produce an invalid query.
    const { limit } = parseLimitOffset(searchParams, { defaultLimit: 20 });

    const conditions = [eq(emailDrafts.tenantId, ctx.tenantId)];

    if (contact_id) {
      conditions.push(eq(emailDrafts.contactId, contact_id));
    }

    if (deal_id) {
      conditions.push(eq(emailDrafts.dealId, deal_id));
    }

    const drafts = await db.select({
      draft: emailDrafts,
      contact: {
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email
      }
    })
    .from(emailDrafts)
    .leftJoin(contacts, eq(contacts.id, emailDrafts.contactId))
    .where(and(...conditions))
    .orderBy(desc(emailDrafts.createdAt))
    .limit(limit);

    // Flatten results for API compatibility
    const flattenedDrafts = drafts.map(d => ({
      ...d.draft,
      first_name: d.contact?.firstName,
      last_name: d.contact?.lastName,
      email: d.contact?.email
    }));

    return NextResponse.json({
      data: flattenedDrafts,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[AI Email Drafts] GET error:', error);
    return apiError(error);
  }
});

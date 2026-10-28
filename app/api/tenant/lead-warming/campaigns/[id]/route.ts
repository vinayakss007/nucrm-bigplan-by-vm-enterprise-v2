/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET    /api/tenant/lead-warming/campaigns/[id] — Get campaign details
 * PATCH  /api/tenant/lead-warming/campaigns/[id] — Update campaign
 * DELETE /api/tenant/lead-warming/campaigns/[id] — Soft-delete campaign
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { requireAiFeature } from '@/lib/ai/plan-gate';
import { db } from '@/drizzle/db';
import { leadWarmingCampaigns, leadWarmingMessages, leadWarmingReplies } from '@/drizzle/schema/lead-warming';
import { eq, and, desc, sql } from 'drizzle-orm';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

 
 
export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    const [campaign] = await db.select()
      .from(leadWarmingCampaigns)
      .where(and(
        eq(leadWarmingCampaigns.id, id),
        eq(leadWarmingCampaigns.tenantId, ctx.tenantId)
      ))
      .limit(1);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Get recent messages
    const recentMessages = await db.select()
      .from(leadWarmingMessages)
      .where(eq(leadWarmingMessages.campaignId, id))
      .orderBy(desc(leadWarmingMessages.createdAt))
      .limit(20);

    // Get reply intent breakdown
    const intentBreakdown = await db.select({
      intent: leadWarmingReplies.intent,
      count: sql<number>`count(*)::int`,
    })
    .from(leadWarmingReplies)
    .where(and(
      eq(leadWarmingReplies.campaignId, id),
      eq(leadWarmingReplies.aiAnalyzed, true)
    ))
    .groupBy(leadWarmingReplies.intent);

    return NextResponse.json({
      data: campaign,
      recentMessages,
      intentBreakdown,
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});

 
 
export const PATCH = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'leads', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(req);

    // #3340: PATCH used to read nothing at all — `status` is freely mutable and
    // the only check was the opt-in `concurrencyGuard` below. Read the row under
    // the same tombstone gate the rest of the flow applies so a status write has
    // a from-state to claim.
    const [existing] = await db
      .select({ id: leadWarmingCampaigns.id, status: leadWarmingCampaigns.status })
      .from(leadWarmingCampaigns)
      .where(and(
        eq(leadWarmingCampaigns.id, id),
        eq(leadWarmingCampaigns.tenantId, ctx.tenantId),
        sql`${leadWarmingCampaigns.deletedAt} IS NULL`
      ))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, leadWarmingCampaigns, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

 
 
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    const allowedFields = [
      'name', 'description', 'status', 'target_filter', 'event_ids',
      'include_birthdays', 'include_anniversaries',
      'enable_email', 'enable_whatsapp', 'enable_sms',
      'ai_generate_messages', 'ai_tone', 'ai_language',
      'ai_analyze_replies', 'auto_respond_to_positive', 'notify_on_positive_intent',
      'max_messages_per_contact_per_month', 'cooldown_days',
    ];

    const fieldMap: Record<string, string> = {
      name: 'name', description: 'description', status: 'status',
      target_filter: 'targetFilter', event_ids: 'eventIds',
      include_birthdays: 'includeBirthdays', include_anniversaries: 'includeAnniversaries',
      enable_email: 'enableEmail', enable_whatsapp: 'enableWhatsapp', enable_sms: 'enableSms',
      ai_generate_messages: 'aiGenerateMessages', ai_tone: 'aiTone', ai_language: 'aiLanguage',
      ai_analyze_replies: 'aiAnalyzeReplies',
      auto_respond_to_positive: 'autoRespondToPositive',
      notify_on_positive_intent: 'notifyOnPositiveIntent',
      max_messages_per_contact_per_month: 'maxMessagesPerContactPerMonth',
      cooldown_days: 'cooldownDays',
    };

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[fieldMap[field] || field] = body[field];
      }
    }

    // #3340: Postgres re-evaluates the UPDATE's WHERE under the row lock, so
    // naming the from-status (and keeping the tombstone gate the read applied)
    // turns a stale write into zero rows instead of a silent stomp — including
    // this route's own `DELETE` (which sets `status:'archived'` + `deletedAt`)
    // landing in the gap: resurrecting a deleted campaign to `active` hands it
    // straight back to lib/lead-warming/engine.ts:198/:469, which select sending
    // candidates by `status='active'` alone and would keep messaging contacts.
    const claimsStatus = updateData.status !== undefined;

    const [updated] = await db.update(leadWarmingCampaigns)
      .set(updateData as Partial<typeof leadWarmingCampaigns.$inferInsert>)
      .where(and(
        eq(leadWarmingCampaigns.id, id),
        eq(leadWarmingCampaigns.tenantId, ctx.tenantId),
        sql`${leadWarmingCampaigns.deletedAt} IS NULL`,
        ...(claimsStatus ? [eq(leadWarmingCampaigns.status, existing.status)] : []),
      ))
      .returning();

    if (!updated) {
      if (claimsStatus) {
        return NextResponse.json(
          { error: `Campaign status changed concurrently — cannot move '${existing.status}' to '${String(updateData.status)}'. Reload and retry.` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: updated });
 
 
  } catch (err) {
    return apiError(err);
  }
});

 
 
export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'leads', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    // #3212: `lead_warming_campaigns` has no `deleted_by` column (this table
    // spreads `utils.lifecycle()`, not `utils.audit()`), and Drizzle builds the
    // SET clause from the table's own column map — a key it does not declare is
    // rendered as nothing, silently. The `as Record<string, unknown>` that made
    // that invisible is gone too, so the next phantom key is a tsc error.
    const [archived] = await db.update(leadWarmingCampaigns)
      .set({ status: 'archived', deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(leadWarmingCampaigns.id, id),
        eq(leadWarmingCampaigns.tenantId, ctx.tenantId)
      ))
      .returning({ id: leadWarmingCampaigns.id });

    // #3212: same read-back the PATCH above this already does — a campaign that
    // vanished since the auth check is not "archived".
    if (!archived) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: 'Campaign archived' });
 
 
  } catch (err) {
    return apiError(err);
  }
});

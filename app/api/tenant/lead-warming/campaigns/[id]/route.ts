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

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(req: NextRequest, { params }: any) {
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = { updatedAt: new Date() };

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

    const [updated] = await db.update(leadWarmingCampaigns)
      .set(updateData)
      .where(and(
        eq(leadWarmingCampaigns.id, id),
        eq(leadWarmingCampaigns.tenantId, ctx.tenantId)
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: updated });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const gate = await requireAiFeature(ctx, 'ai_lead_warming');
    if (gate) return gate;

    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    await db.update(leadWarmingCampaigns)
      .set({ status: 'archived', deletedAt: new Date() })
      .where(and(
        eq(leadWarmingCampaigns.id, id),
        eq(leadWarmingCampaigns.tenantId, ctx.tenantId)
      ));

    return NextResponse.json({ ok: true, message: 'Campaign archived' });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

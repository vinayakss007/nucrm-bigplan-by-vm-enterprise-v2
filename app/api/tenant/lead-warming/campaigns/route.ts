/**
 * GET  /api/tenant/lead-warming/campaigns — List campaigns
 * POST /api/tenant/lead-warming/campaigns — Create campaign
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { leadWarmingCampaigns } from '@/drizzle/schema/lead-warming';
import { eq, and, desc, isNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    const conditions = [
      eq(leadWarmingCampaigns.tenantId, ctx.tenantId),
      isNull(leadWarmingCampaigns.deletedAt),
    ];
    if (status && status !== 'all') {
      conditions.push(eq(leadWarmingCampaigns.status, status));
    }

    const campaigns = await db.select()
      .from(leadWarmingCampaigns)
      .where(and(...conditions))
      .orderBy(desc(leadWarmingCampaigns.createdAt));

    return NextResponse.json({ data: campaigns });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await req.json();
    const {
      name, description, target_filter, event_ids,
      include_birthdays, include_anniversaries,
      enable_email, enable_whatsapp, enable_sms,
      ai_generate_messages, ai_tone, ai_language,
      ai_analyze_replies, auto_respond_to_positive, notify_on_positive_intent,
      max_messages_per_contact_per_month, cooldown_days,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
    }

    const [campaign] = await db.insert(leadWarmingCampaigns)
      .values({
        tenantId: ctx.tenantId,
        name: name.trim(),
        description: description || null,
        status: 'active',
        targetFilter: target_filter || {},
        eventIds: event_ids || [],
        includeBirthdays: include_birthdays ?? true,
        includeAnniversaries: include_anniversaries ?? false,
        enableEmail: enable_email ?? true,
        enableWhatsapp: enable_whatsapp ?? true,
        enableSms: enable_sms ?? false,
        aiGenerateMessages: ai_generate_messages ?? true,
        aiTone: ai_tone || 'warm_professional',
        aiLanguage: ai_language || 'en',
        aiAnalyzeReplies: ai_analyze_replies ?? true,
        autoRespondToPositive: auto_respond_to_positive ?? false,
        notifyOnPositiveIntent: notify_on_positive_intent ?? true,
        maxMessagesPerContactPerMonth: max_messages_per_contact_per_month || 4,
        cooldownDays: cooldown_days || 7,
        createdBy: ctx.userId,
      })
      .returning();

    return NextResponse.json({ ok: true, data: campaign }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

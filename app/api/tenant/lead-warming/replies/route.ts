/**
 * GET  /api/tenant/lead-warming/replies — List reply analyses with intent
 * POST /api/tenant/lead-warming/replies — Manually submit a reply for analysis
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { leadWarmingReplies, leadWarmingMessages } from '@/drizzle/schema/lead-warming';
import { contacts } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { processIncomingReply } from '@/lib/lead-warming/reply-analyzer';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const intent = searchParams.get('intent');
    const campaignId = searchParams.get('campaign_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    const conditions = [eq(leadWarmingReplies.tenantId, ctx.tenantId)];
    if (intent) conditions.push(eq(leadWarmingReplies.intent, intent));
    if (campaignId) conditions.push(eq(leadWarmingReplies.campaignId, campaignId));

    const replies = await db.select({
      id: leadWarmingReplies.id,
      channel: leadWarmingReplies.channel,
      replyContent: leadWarmingReplies.replyContent,
      receivedAt: leadWarmingReplies.receivedAt,
      intent: leadWarmingReplies.intent,
      intentConfidence: leadWarmingReplies.intentConfidence,
      sentiment: leadWarmingReplies.sentiment,
      sentimentScore: leadWarmingReplies.sentimentScore,
      aiSummary: leadWarmingReplies.aiSummary,
      aiSuggestedAction: leadWarmingReplies.aiSuggestedAction,
      aiExtractedEntities: leadWarmingReplies.aiExtractedEntities,
      requiresFollowUp: leadWarmingReplies.requiresFollowUp,
      followUpCreated: leadWarmingReplies.followUpCreated,
      ownerNotified: leadWarmingReplies.ownerNotified,
      contactId: leadWarmingReplies.contactId,
      contactName: sql<string>`COALESCE(${contacts.firstName} || ' ' || ${contacts.lastName}, ${contacts.email}, 'Unknown')`,
    })
    .from(leadWarmingReplies)
    .leftJoin(contacts, eq(leadWarmingReplies.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(leadWarmingReplies.receivedAt))
    .limit(limit);

    return NextResponse.json({ data: replies });
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
    const { message_id, reply_content, channel } = body;

    if (!message_id || !reply_content) {
      return NextResponse.json({ error: 'message_id and reply_content are required' }, { status: 400 });
    }

    // Verify the message belongs to this tenant
    const [msg] = await db.select({ id: leadWarmingMessages.id })
      .from(leadWarmingMessages)
      .where(and(
        eq(leadWarmingMessages.id, message_id),
        eq(leadWarmingMessages.tenantId, ctx.tenantId)
      ))
      .limit(1);

    if (!msg) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const analysis = await processIncomingReply({
      tenantId: ctx.tenantId,
      messageId: message_id,
      replyContent: reply_content,
      channel: channel || 'email',
    });

    if (!analysis) {
      return NextResponse.json({ error: 'Failed to analyze reply' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, analysis }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

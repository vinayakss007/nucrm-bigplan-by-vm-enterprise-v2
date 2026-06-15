/**
 * GET /api/tenant/lead-warming/stats — Dashboard stats for lead warming
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import {
  leadWarmingCampaigns,
  leadWarmingMessages,
  leadWarmingReplies,
} from '@/drizzle/schema/lead-warming';
import { eq, and, sql, gte } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Active campaigns count
    const [campaignStats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) FILTER (WHERE status = 'active')::int`,
    })
    .from(leadWarmingCampaigns)
    .where(eq(leadWarmingCampaigns.tenantId, ctx.tenantId));

    // Messages sent (last 30 days)
    const [messageStats] = await db.select({
      total: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) FILTER (WHERE status IN ('sent', 'delivered'))::int`,
      queued: sql<number>`count(*) FILTER (WHERE status = 'queued')::int`,
      failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
      emailCount: sql<number>`count(*) FILTER (WHERE channel = 'email')::int`,
      whatsappCount: sql<number>`count(*) FILTER (WHERE channel = 'whatsapp')::int`,
    })
    .from(leadWarmingMessages)
    .where(and(
      eq(leadWarmingMessages.tenantId, ctx.tenantId),
      gte(leadWarmingMessages.createdAt, thirtyDaysAgo)
    ));

    // Reply analysis (last 30 days)
    const [replyStats] = await db.select({
      total: sql<number>`count(*)::int`,
      interested: sql<number>`count(*) FILTER (WHERE intent = 'interested')::int`,
      notInterested: sql<number>`count(*) FILTER (WHERE intent = 'not_interested')::int`,
      askLater: sql<number>`count(*) FILTER (WHERE intent = 'ask_later')::int`,
      question: sql<number>`count(*) FILTER (WHERE intent = 'question')::int`,
      positiveSocial: sql<number>`count(*) FILTER (WHERE intent = 'positive_social')::int`,
      unsubscribe: sql<number>`count(*) FILTER (WHERE intent = 'unsubscribe')::int`,
    })
    .from(leadWarmingReplies)
    .where(and(
      eq(leadWarmingReplies.tenantId, ctx.tenantId),
      gte(leadWarmingReplies.receivedAt, thirtyDaysAgo)
    ));

    // Reply rate calculation
    const totalSent = messageStats?.sent || 0;
    const totalReplies = replyStats?.total || 0;
    const replyRate = totalSent > 0 ? Math.round((totalReplies / totalSent) * 100) : 0;
    const positiveRate = totalReplies > 0
      ? Math.round(((replyStats?.interested || 0) / totalReplies) * 100)
      : 0;

    return NextResponse.json({
      campaigns: campaignStats,
      messages: {
        ...messageStats,
        period: '30_days',
      },
      replies: {
        ...replyStats,
        replyRate,
        positiveRate,
        period: '30_days',
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

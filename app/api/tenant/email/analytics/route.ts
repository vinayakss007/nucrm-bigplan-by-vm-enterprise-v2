/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailOpens, emailClicks } from '@/drizzle/schema/email-tracking';
import { emailTracking } from '@/drizzle/schema/comm';
import { contacts } from '@/drizzle/schema/crm';
import { eq, and, count, gte, desc, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/email/analytics
 *
 * Aggregated email engagement metrics for the current tenant. This is the
 * reporting endpoint the Email Analytics page consumes. It is distinct from
 * /api/tenant/email/track, which is the PUBLIC, unauthenticated tracking-pixel
 * / click-redirect ingestion endpoint (that one returns a GIF, not JSON).
 *
 * Query params:
 *   - days: look-back window in days (default 30, max 365)
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(req.url);
    const daysRaw = parseInt(searchParams.get('days') || '30', 10);
    const days = Math.min(365, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      [sentRow],
      [openRow],
      [clickRow],
      recentOpens,
      recentClicks,
    ] = await Promise.all([
      // Total emails sent (tracked) in the window
      db
        .select({ c: count() })
        .from(emailTracking)
        .where(and(eq(emailTracking.tenantId, tenantId), gte(emailTracking.sentAt, since))),
      // Total open events
      db
        .select({ c: count() })
        .from(emailOpens)
        .where(and(eq(emailOpens.tenantId, tenantId), gte(emailOpens.openedAt, since))),
      // Total click events
      db
        .select({ c: count() })
        .from(emailClicks)
        .where(and(eq(emailClicks.tenantId, tenantId), gte(emailClicks.clickedAt, since))),
      // Recent open events (joined to contact for email + subject)
      db
        .select({
          id: emailOpens.id,
          type: sql<string>`'open'`,
          contactEmail: contacts.email,
          contactFirst: contacts.firstName,
          contactLast: contacts.lastName,
          timestamp: emailOpens.openedAt,
          link: sql<string | null>`NULL`,
        })
        .from(emailOpens)
        .leftJoin(contacts, eq(contacts.id, emailOpens.contactId))
        .where(and(eq(emailOpens.tenantId, tenantId), gte(emailOpens.openedAt, since)))
        .orderBy(desc(emailOpens.openedAt))
        .limit(25),
      // Recent click events
      db
        .select({
          id: emailClicks.id,
          type: sql<string>`'click'`,
          contactEmail: contacts.email,
          contactFirst: contacts.firstName,
          contactLast: contacts.lastName,
          timestamp: emailClicks.clickedAt,
          link: emailClicks.linkUrl,
        })
        .from(emailClicks)
        .leftJoin(contacts, eq(contacts.id, emailClicks.contactId))
        .where(and(eq(emailClicks.tenantId, tenantId), gte(emailClicks.clickedAt, since)))
        .orderBy(desc(emailClicks.clickedAt))
        .limit(25),
    ]);

    const totalTracked = sentRow?.c ?? 0;
    const opens = openRow?.c ?? 0;
    const clicks = clickRow?.c ?? 0;
    const openRate = totalTracked > 0 ? Math.round((opens / totalTracked) * 100) : 0;
    const clickRate = totalTracked > 0 ? Math.round((clicks / totalTracked) * 100) : 0;

    // Per-campaign aggregation (opens + clicks grouped by campaign_id).
    const campaignOpens = await db
      .select({ campaignId: emailOpens.campaignId, c: count() })
      .from(emailOpens)
      .where(and(eq(emailOpens.tenantId, tenantId), gte(emailOpens.openedAt, since)))
      .groupBy(emailOpens.campaignId);
    const campaignClicks = await db
      .select({ campaignId: emailClicks.campaignId, c: count() })
      .from(emailClicks)
      .where(and(eq(emailClicks.tenantId, tenantId), gte(emailClicks.clickedAt, since)))
      .groupBy(emailClicks.campaignId);

    const campaignMap = new Map<string, { campaignId: string; opens: number; clicks: number }>();
    for (const row of campaignOpens) {
      const key = row.campaignId ?? 'unattributed';
      const entry = campaignMap.get(key) ?? { campaignId: key, opens: 0, clicks: 0 };
      entry.opens = row.c;
      campaignMap.set(key, entry);
    }
    for (const row of campaignClicks) {
      const key = row.campaignId ?? 'unattributed';
      const entry = campaignMap.get(key) ?? { campaignId: key, opens: 0, clicks: 0 };
      entry.clicks = row.c;
      campaignMap.set(key, entry);
    }
    const byCampaignBreakdown = [...campaignMap.values()].sort(
      (a, b) => b.opens + b.clicks - (a.opens + a.clicks),
    );

    // Merge + sort recent events, cap at 50.
    const fmtName = (first?: string | null, last?: string | null, email?: string | null) => {
      const name = [first, last].filter(Boolean).join(' ').trim();
      return email || name || 'Unknown';
    };
    const events = [...recentOpens, ...recentClicks]
      .map((e) => ({
        id: e.id,
        type: e.type as 'open' | 'click',
        contactEmail: fmtName(e.contactFirst, e.contactLast, e.contactEmail),
        subject: '',
        timestamp: e.timestamp,
        link: e.link ?? undefined,
      }))
      .sort((a, b) => new Date(b.timestamp as unknown as string).getTime() - new Date(a.timestamp as unknown as string).getTime())
      .slice(0, 50);

    return NextResponse.json({
      data: {
        totalTracked,
        opens,
        clicks,
        openRate,
        clickRate,
        byCampaign: byCampaignBreakdown,
        events,
        windowDays: days,
      },
    });
  } catch (err) {
    void logError({ error: err, context: 'tenant/email/analytics GET' });
    return NextResponse.json({ error: 'Failed to load email analytics' }, { status: 500 });
  }
});

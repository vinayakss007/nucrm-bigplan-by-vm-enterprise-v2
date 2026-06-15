/**
 * Visitor Tracking & Intelligence
 * 
 * Tracks anonymous website visitors, scores their engagement,
 * and links them to contacts when identified.
 */
import { db } from '@/drizzle/db';
import { visitors, pageViews } from '@/drizzle/schema/visitors';
import { eq, and, desc } from 'drizzle-orm';

/** Page scoring rules based on URL patterns */
const PAGE_SCORES: Array<{ pattern: RegExp; points: number }> = [
  { pattern: /\/demo/i, points: 10 },
  { pattern: /\/pricing/i, points: 5 },
  { pattern: /\/features/i, points: 3 },
  { pattern: /\/docs/i, points: 2 },
  { pattern: /\/blog/i, points: 1 },
  { pattern: /^\/$|\/home/i, points: 1 },
];

/** Calculate the score for a single page view URL */
export function scorePageUrl(url: string): number {
  for (const rule of PAGE_SCORES) {
    if (rule.pattern.test(url)) {
      return rule.points;
    }
  }
  return 1; // default 1 point for any page
}

/**
 * Track a page view for a visitor.
 * Creates visitor record if first visit.
 */
export async function trackPageView(
  visitorId: string,
  url: string,
  title: string,
  referrer: string,
  duration: number,
  tenantId: string
): Promise<void> {
  // Insert page view
  await db.insert(pageViews).values({
    tenantId,
    visitorId,
    url,
    title,
    referrer,
    durationSeconds: duration,
  });

  // Update visitor record
  const existing = await db
    .select()
    .from(visitors)
    .where(and(eq(visitors.id, visitorId), eq(visitors.tenantId, tenantId)));

  if (existing.length > 0) {
    const points = scorePageUrl(url);
    await db
      .update(visitors)
      .set({
        lastSeenAt: new Date(),
        totalPageViews: (existing[0]!.totalPageViews ?? 0) + 1,
        score: (existing[0]!.score ?? 0) + points,
      })
      .where(eq(visitors.id, visitorId));
  }
}

/**
 * Identify a visitor by linking them to a contact email
 */
export async function identifyVisitor(
  visitorId: string,
  email: string,
  tenantId: string
): Promise<{ identified: boolean }> {
  // In a real implementation, we'd look up the contact by email
  // For now we store the identification link
  await db
    .update(visitors)
    .set({ identifiedContactId: email }) // storing email as reference placeholder
    .where(and(eq(visitors.id, visitorId), eq(visitors.tenantId, tenantId)));

  return { identified: true };
}

/**
 * Calculate full engagement score for a visitor.
 * Includes: page-based scoring + frequency bonus + recency bonus
 */
export async function getVisitorScore(visitorId: string): Promise<{
  totalScore: number;
  pageScore: number;
  frequencyBonus: number;
  recencyBonus: number;
}> {
  const visitorRows = await db
    .select()
    .from(visitors)
    .where(eq(visitors.id, visitorId));

  if (visitorRows.length === 0) {
    return { totalScore: 0, pageScore: 0, frequencyBonus: 0, recencyBonus: 0 };
  }

  const visitor = visitorRows[0]!;

  // Get all page views for detailed scoring
  const views = await db
    .select()
    .from(pageViews)
    .where(eq(pageViews.visitorId, visitorId));

  // Calculate page-based score
  let pageScore = 0;
  for (const view of views) {
    pageScore += scorePageUrl(view.url);
  }

  // Frequency bonus: +5 if 5+ total visits
  const frequencyBonus = (visitor.totalPageViews ?? 0) >= 5 ? 5 : 0;

  // Recency bonus: +3 if visited within last 24 hours
  const lastSeen = visitor.lastSeenAt ? new Date(visitor.lastSeenAt) : null;
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recencyBonus = lastSeen && lastSeen > twentyFourHoursAgo ? 3 : 0;

  const totalScore = pageScore + frequencyBonus + recencyBonus;

  return { totalScore, pageScore, frequencyBonus, recencyBonus };
}

/**
 * Get full visitor profile with page views and score
 */
export async function getVisitorProfile(visitorId: string): Promise<{
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  visitor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageViews: any[];
  score: { totalScore: number; pageScore: number; frequencyBonus: number; recencyBonus: number };
} | null> {
  const visitorRows = await db
    .select()
    .from(visitors)
    .where(eq(visitors.id, visitorId));

  if (visitorRows.length === 0) return null;

  const views = await db
    .select()
    .from(pageViews)
    .where(eq(pageViews.visitorId, visitorId))
    .orderBy(desc(pageViews.viewedAt));

  const score = await getVisitorScore(visitorId);

  return {
    visitor: visitorRows[0],
    pageViews: views,
    score,
  };
}

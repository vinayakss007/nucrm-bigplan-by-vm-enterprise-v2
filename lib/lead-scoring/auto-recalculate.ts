/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Lead Score Auto-Recalculation
 *
 * Automatically adjusts lead scores when significant events occur.
 * Called from activity creation, deal stage changes, email opens, etc.
 *
 * Scoring factors:
 * - Email opened: +5
 * - Email clicked: +10
 * - Form submitted: +15
 * - Meeting scheduled: +20
 * - Deal created from lead: +30
 * - No activity in 7 days: -10
 * - No activity in 14 days: -20
 * - Replied to email: +15
 * - Page visit (tracked): +3
 */

import { db } from '@/drizzle/db';
import { leads } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export type ScoreEvent =
  | 'email_opened'
  | 'email_clicked'
  | 'form_submitted'
  | 'meeting_scheduled'
  | 'deal_created'
  | 'email_replied'
  | 'page_visit'
  | 'inactivity_7d'
  | 'inactivity_14d'
  | 'call_completed'
  | 'document_viewed';

const SCORE_ADJUSTMENTS: Record<ScoreEvent, number> = {
  email_opened: 5,
  email_clicked: 10,
  form_submitted: 15,
  meeting_scheduled: 20,
  deal_created: 30,
  email_replied: 15,
  page_visit: 3,
  inactivity_7d: -10,
  inactivity_14d: -20,
  call_completed: 10,
  document_viewed: 8,
};

/**
 * Adjust a lead's score based on an event.
 * Score is clamped between 0 and 100.
 * Non-blocking: errors are logged but don't propagate.
 */
export async function adjustLeadScore(
  leadId: string,
  tenantId: string,
  event: ScoreEvent
): Promise<void> {
  try {
    const adjustment = SCORE_ADJUSTMENTS[event];
    if (!adjustment) return;

    await db
      .update(leads)
      .set({
        score: sql`LEAST(100, GREATEST(0, COALESCE(${leads.score}, 0) + ${adjustment}))`,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));
  } catch (err) {
    console.error('[lead-scoring] Failed to adjust score:', err);
  }
}

/**
 * Recalculate a lead's score from scratch based on all their activities.
 * Used for periodic batch recalculation or manual refresh.
 */
export async function recalculateLeadScore(
  leadId: string,
  tenantId: string,
  activityCount: number,
  hasEmail: boolean,
  hasPhone: boolean,
  daysSinceLastActivity: number
): Promise<number> {
  let score = 0;

  // Base score from profile completeness
  if (hasEmail) score += 10;
  if (hasPhone) score += 5;

  // Activity-based scoring
  score += Math.min(30, activityCount * 5); // Up to 30 points from activities

  // Engagement decay
  if (daysSinceLastActivity > 14) score -= 20;
  else if (daysSinceLastActivity > 7) score -= 10;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  try {
    await db
      .update(leads)
      .set({ score, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));
  } catch (err) {
    console.error('[lead-scoring] Recalculate failed:', err);
  }

  return score;
}

export { SCORE_ADJUSTMENTS };

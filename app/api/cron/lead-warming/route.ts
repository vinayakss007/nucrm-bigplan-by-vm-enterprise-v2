/**
 * POST /api/cron/lead-warming
 *
 * Daily cron job that processes all active lead warming campaigns.
 * Sends personalized festival/birthday greetings via Email + WhatsApp.
 * Also processes unanalyzed replies through AI intent detection.
 *
 * Schedule: Daily at 9:00 AM (configurable per event)
 * Protected by: x-cron-secret header
 */

import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processLeadWarming, resetMonthlyCounters } from '@/lib/lead-warming/engine';
import { analyzeUnprocessedReplies } from '@/lib/lead-warming/reply-analyzer';
import { apiError } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  // Validate cron secret
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = {};

  try {
    // 1. Process lead warming (send messages for today's events)
    const warmingResult = await processLeadWarming();
    results['warming'] = warmingResult;

    // 2. Analyze any unprocessed replies
    const replyResult = await analyzeUnprocessedReplies(50);
    results['replies'] = replyResult;

    // 3. Reset monthly counters on the 1st of each month
    const today = new Date();
    if (today.getDate() === 1) {
      await resetMonthlyCounters();
      results['monthlyReset'] = true;
    }

    console.log('[cron/lead-warming] Completed:', JSON.stringify(results));

    return NextResponse.json({
      ok: true,
      ...results,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[cron/lead-warming] Error:', err.message);
    return apiError(err, "Internal server error", 500);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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

import { verifyCronSecret } from '@/lib/auth/cron';
import { logError } from '@/lib/errors-server';
import { refuseIfCronLockHeld } from '@/lib/cron/cron-lock';
import { NextRequest, NextResponse } from 'next/server';
import { processLeadWarming, resetMonthlyCounters, type WarmingResult } from '@/lib/lead-warming/engine';
import { analyzeUnprocessedReplies } from '@/lib/lead-warming/reply-analyzer';
import { apiError } from '@/lib/api-error';
import { sweepTenants } from '@/lib/cron/tenant-scope';

export async function POST(req: NextRequest) {
  // Validate cron secret
  if (!await verifyCronSecret(req, { job: 'lead-warming' })) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1255): skip if another scheduler already ran it.
  const refusal = await refuseIfCronLockHeld('cron:lead-warming', 1800);
  if (refusal) return refusal;

  try {
    // Engine counters are per run, so they are summed across the sweep and the
    // response keeps the same 'warming' / 'replies' / 'monthlyReset' shape.
    const warmingTotals: WarmingResult = {
      campaignsProcessed: 0,
      messagesSent: 0,
      messagesQueued: 0,
      errors: [],
      skippedContacts: 0,
    };
    const replyTotals = { processed: 0, errors: 0 };
    let monthlyResetRows = 0;

    // lead_warming_campaigns, lead_warming_messages, lead_warming_schedule,
    // lead_warming_replies and contacts all enforce a plain tenant_isolation
    // policy with no super-admin branch, so on the bare pool the engine saw no
    // campaigns, no contacts and no replies: it queued nothing and still
    // returned a clean result. Each step therefore runs once per tenant under
    // that tenant's own context — see lib/cron/tenant-scope.ts.
    const sweep = await sweepTenants('cron/lead-warming', async () => {
      // 0. #3048: monthly catch-up runs on EVERY cron execution, before the
      // sends — the reset is idempotent (its SQL predicate only matches rows
      // whose counter predates the current UTC month), so a failed day-1 run
      // no longer stalls throttling until next month, and it must zero stale
      // counts before today's sends read them.
      monthlyResetRows += await resetMonthlyCounters();

      // 1. Process lead warming (send messages for today's events)
      const warmingResult = await processLeadWarming();
      warmingTotals.campaignsProcessed += warmingResult.campaignsProcessed;
      warmingTotals.messagesSent += warmingResult.messagesSent;
      warmingTotals.messagesQueued += warmingResult.messagesQueued;
      warmingTotals.skippedContacts += warmingResult.skippedContacts;
      warmingTotals.errors.push(...warmingResult.errors);

      // 2. Analyze any unprocessed replies (batch cap is per tenant now — the
      // unscoped run never reached any tenant's replies at all)
      const replyResult = await analyzeUnprocessedReplies(50);
      replyTotals.processed += replyResult.processed;
      replyTotals.errors += replyResult.errors;
    });

    const results: Record<string, unknown> = {
      warming: warmingTotals,
      replies: replyTotals,
      // #3048: keep the flag, add the row count so a stuck month is visible
      // in the response instead of hinging on which calendar day ran.
      monthlyReset: monthlyResetRows > 0,
      monthlyResetRows,
    };

    console.log('[cron/lead-warming] Completed:', JSON.stringify(results));

    return NextResponse.json({
      ok: sweep.failed.length === 0,
      tenants_checked: sweep.visited,
      tenants_skipped: sweep.skipped.length,
      tenants_failed: sweep.failed.length,
      ...results,
    });

  } catch (err) {
    void logError({ error: err, context: 'cron/lead-warming' });
    return apiError(err, "Internal server error", 500);
  }
}

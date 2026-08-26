/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { retryFailedWebhooks } from '@/lib/webhooks';
import { purgeOldDLQEntries } from '@/lib/webhooks/dlq';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:retry-webhooks', 300);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }
  try {
    const retried = await retryFailedWebhooks();

    // Purge dead letter queue entries older than 30 days
    let purged = 0;
    try {
      purged = await purgeOldDLQEntries(30);
    } catch (purgeErr) {
      console.error('[RetryWebhooks] DLQ purge error:', purgeErr);
    }

    return NextResponse.json({ ok: true, retried, dlqPurged: purged });
  } catch (err) {
    console.error('[RetryWebhooks] Error:', err);
    return NextResponse.json({ error: 'Failed to retry webhooks' }, { status: 500 });
  }
}

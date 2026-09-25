/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifySecret } from '@/lib/crypto';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { retryFailedWebhooks } from '@/lib/webhooks';
import { purgeOldDLQEntries } from '@/lib/webhooks/dlq';
// The retry scan is cross-tenant and the DLQ purge writes dead_letter_queue,
// whose policy admits only the super-admin context (NUCRM-A). Pin one client
// and mark it so the helpers below inherit the context.
import { withApiRoute } from '@/lib/api/with-api-route';
import { setSuperAdminContext } from '@/lib/db/rls';

export const POST = withApiRoute(async (req: NextRequest) => {
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
    await setSuperAdminContext();
    const retried = await retryFailedWebhooks();

    // Purge dead letter queue entries older than 30 days
    let purged = 0;
    try {
      purged = await purgeOldDLQEntries(30);
    } catch (purgeErr) {
      void logError({ error: purgeErr, context: 'cron/retry-webhooks DLQ purge', level: 'warning' });
    }

    return NextResponse.json({ ok: true, retried, dlqPurged: purged });
  } catch (err) {
    void logError({ error: err, context: 'cron/retry-webhooks' });
    return NextResponse.json({ error: 'Failed to retry webhooks' }, { status: 500 });
  }
});

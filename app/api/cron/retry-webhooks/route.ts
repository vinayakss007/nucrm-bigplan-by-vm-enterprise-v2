import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { retryFailedWebhooks } from '@/lib/webhooks';
import { purgeOldDLQEntries } from '@/lib/webhooks/dlq';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

import { verifySecret } from '@/lib/crypto';
import { logError } from '@/lib/errors';
import { NextRequest, NextResponse } from 'next/server';
import { retryFailedWebhooks } from '@/lib/webhooks';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const retried = await retryFailedWebhooks();
  return NextResponse.json({ ok: true, retried });
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifySecret } from '@/lib/crypto';
import { processWarmUp } from '@/lib/email/warmup';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await processWarmUp();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[WarmupEmails] Error:', err);
    return NextResponse.json({ error: 'Failed to process warmup' }, { status: 500 });
  }
}

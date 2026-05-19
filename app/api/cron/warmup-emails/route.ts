import { verifySecret } from '@/lib/crypto';
import { processWarmUp } from '@/lib/email/warmup';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await processWarmUp();
  return NextResponse.json({ ok: true, ...result });
}

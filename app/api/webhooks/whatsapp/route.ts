/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
/**
 * WhatsApp Business API Webhook
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { addJob } from '@/lib/queue';
import { processWhatsAppPayload } from '@/lib/whatsapp/webhook-processor';

// ─── GET: Verify Webhook ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// ─── POST: Receive Messages & Status Updates ─────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-hub-signature-256');
    const appSecret = process.env['WHATSAPP_APP_SECRET'];

    if (!signature || !appSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await req.text();
    const expectedSignature = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // #1256: never drop messages on transient failures. Preferred path is the
    // queue (BullMQ/pg-boss) which retries with exponential backoff. If the
    // queue itself is unavailable, process inline; if that also fails, return
    // 500 so Meta redelivers instead of us acknowledging a lost message.
    let enqueued = false;
    try {
      await addJob('whatsapp-webhook', body, { attempts: 5 });
      enqueued = true;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (enqueueErr: any) {
      void logError({ error: enqueueErr, context: 'webhooks/whatsapp queue unavailable, inline fallback', level: 'warning' });
    }

    if (!enqueued) {
      try {
        await processWhatsAppPayload(body);
      } catch (processErr) {
        void logError({ error: processErr, context: 'webhooks/whatsapp inline processing (500 for Meta redelivery)' });
        return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'webhooks/whatsapp' });
    return apiError(err);
  }
}

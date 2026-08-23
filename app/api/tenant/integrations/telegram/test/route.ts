/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
import { apiError } from '@/lib/api-error';
 * POST /api/tenant/integrations/telegram/test
 * Send a test Telegram message to verify bot token and chat ID
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { readJsonBody } from '@/lib/api/validate';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(req);
    const { bot_token, chat_id } = body;

    if (!bot_token || !chat_id) {
      return NextResponse.json({ error: 'bot_token and chat_id are required' }, { status: 400 });
    }

    const response = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text: `✅ NuCRM Telegram integration test — this is working correctly!\n\nTenant: ${ctx.tenantId}\nTime: ${new Date().toISOString()}`,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.description || 'Failed to send test message' },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, message: 'Test message sent successfully' });
 
 
 
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[telegram/test]', msg);
    return NextResponse.json({ error: 'Failed to send test message' }, { status: 500 });
  }
}

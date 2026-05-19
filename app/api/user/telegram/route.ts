import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

// GET /api/user/telegram - Get user's Telegram settings
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const user = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: {
        telegramBotToken: true,
        telegramChatId: true,
        telegramEnabled: true,
        telegramNotifyLogin: true,
        telegramNotifySignup: true,
        telegramNotifyPasswordChange: true,
        telegramNotify2faChange: true,
        telegramNotifySecurityAlerts: true,
      }
    });

    return NextResponse.json({
      ok: true,
      settings: user ? {
        telegram_bot_token: user.telegramBotToken,
        telegram_chat_id: user.telegramChatId,
        telegram_enabled: user.telegramEnabled,
        telegram_notify_login: user.telegramNotifyLogin,
        telegram_notify_signup: user.telegramNotifySignup,
        telegram_notify_password_change: user.telegramNotifyPasswordChange,
        telegram_notify_2fa_change: user.telegramNotify2faChange,
        telegram_notify_security_alerts: user.telegramNotifySecurityAlerts,
      } : {
        telegram_bot_token: null,
        telegram_chat_id: null,
        telegram_enabled: false,
        telegram_notify_login: true,
        telegram_notify_signup: true,
        telegram_notify_password_change: true,
        telegram_notify_2fa_change: true,
        telegram_notify_security_alerts: true,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/user/telegram - Update Telegram settings
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const {
      telegram_bot_token,
      telegram_chat_id,
      telegram_enabled,
      telegram_notify_login,
      telegram_notify_signup,
      telegram_notify_password_change,
      telegram_notify_2fa_change,
      telegram_notify_security_alerts,
    } = body;

    // If testing the bot, verify it works
    if (body.action === 'test' && telegram_bot_token && telegram_chat_id) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${telegram_bot_token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram_chat_id,
            text: '✅ *NuCRM Connection Test*\n\nYour Telegram notifications are working! 🎉',
            parse_mode: 'Markdown',
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return NextResponse.json({
            error: `Telegram error: ${data.description || res.status}`,
          }, { status: 400 });
        }

        return NextResponse.json({ ok: true, message: 'Test message sent!' });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }

    await db.update(users)
      .set({
        telegramBotToken: telegram_bot_token || null,
        telegramChatId: telegram_chat_id || null,
        telegramEnabled: telegram_enabled ?? false,
        telegramNotifyLogin: telegram_notify_login ?? true,
        telegramNotifySignup: telegram_notify_signup ?? true,
        telegramNotifyPasswordChange: telegram_notify_password_change ?? true,
        telegramNotify2faChange: telegram_notify_2fa_change ?? true,
        telegramNotifySecurityAlerts: telegram_notify_security_alerts ?? true,
        updatedAt: new Date()
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

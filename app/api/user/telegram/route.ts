/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateTelegramSchema } from '@/lib/api/schemas';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * #2523: a Telegram bot token is a credential, not a preference —
 * `https://api.telegram.org/bot<token>/sendMessage` is literally how alerts go out
 * (`PATCH`'s own test call below, and the real alerts from `lib/email/service.ts:433`),
 * so whoever holds it can send as the org and read its chat ids.
 * `GET` used to ship it into client JS state on every load of the settings page.
 *
 * The raw token never leaves this file. The page still needs to know whether one is
 * configured and which bot that is, so it gets a flag plus the `****<last4>` hint —
 * the convention #2276 established for webhook signing secrets and the plugins use
 * for `webhookSecret`.
 */
function tokenHint(value: string | null | undefined): { configured: boolean; hint: string | null } {
  if (!value) return { configured: false, hint: null };
  return { configured: true, hint: value.length <= 4 ? '****' : `****${value.slice(-4)}` };
}

/**
 * `PATCH` used to write `telegramBotToken: body || null`, so an omitted token meant
 * *clear it*. Once `GET` stopped returning the token the settings form can no longer
 * prefill it, and a save that only flipped a notification toggle would silently
 * destroy a working bot. So the three cases are now distinct (#2520 did the same for
 * SSO): a **non-empty string** sets it, **blank or absent keeps** the stored value,
 * and only an **explicit JSON `null`** disconnects the bot.
 */
function keepStoredToken(incoming: string | null | undefined, stored: string | null): string | null {
  if (incoming === null) return null;
  const trimmed = typeof incoming === 'string' ? incoming.trim() : '';
  if (!trimmed) return stored;
  return trimmed;
}

// GET /api/user/telegram - Get user's Telegram settings
export const GET = withApiRoute(async (request: NextRequest) => {
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

    const hint = tokenHint(user?.telegramBotToken);

    return NextResponse.json({
      ok: true,
      settings: user ? {
        telegram_bot_token_configured: hint.configured,
        telegram_bot_token_hint: hint.hint,
        telegram_chat_id: user.telegramChatId,
        telegram_enabled: user.telegramEnabled,
        telegram_notify_login: user.telegramNotifyLogin,
        telegram_notify_signup: user.telegramNotifySignup,
        telegram_notify_password_change: user.telegramNotifyPasswordChange,
        telegram_notify_2fa_change: user.telegramNotify2faChange,
        telegram_notify_security_alerts: user.telegramNotifySecurityAlerts,
      } : {
        telegram_bot_token_configured: false,
        telegram_bot_token_hint: null,
        telegram_chat_id: null,
        telegram_enabled: false,
        telegram_notify_login: true,
        telegram_notify_signup: true,
        telegram_notify_password_change: true,
        telegram_notify_2fa_change: true,
        telegram_notify_security_alerts: true,
      },
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});

// PATCH /api/user/telegram - Update Telegram settings
export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(updateTelegramSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const body = validated.data;
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

    const stored = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { telegramBotToken: true, telegramChatId: true },
    });
    const effectiveToken = keepStoredToken(telegram_bot_token, stored?.telegramBotToken ?? null);

    // If testing the bot, verify it works
    if (body.action === 'test' && effectiveToken && (telegram_chat_id || stored?.telegramChatId)) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram_chat_id || stored?.telegramChatId,
            text: '✅ *NuCRM Connection Test*\n\nYour Telegram notifications are working! 🎉',
            parse_mode: 'Markdown',
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const data = await res.json().catch((err) => { void logError({ error: err, context: 'user/telegram response parse', level: 'warning' }); return { description: `HTTP ${res.status}` }; });
          return NextResponse.json({
            error: `Telegram error: ${data.description || res.status}`,
          }, { status: 400 });
        }

        return NextResponse.json({ ok: true, message: 'Test message sent!' });
 
 
      } catch (err) {
        return apiError(err, "Bad request", 400);
      }
    }

    // Optimistic concurrency guard
    const _eu = rawBody?.expectedUpdatedAt ?? rawBody?._updated_at;
    if (_eu) {
      const _cg = await concurrencyGuard(db, users, ctx.userId, null, _eu);
      if (_cg) return _cg;
    }

    await db.update(users)
      .set({
        telegramBotToken: effectiveToken,
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
 
 
  } catch (err) {
    return apiError(err);
  }
});

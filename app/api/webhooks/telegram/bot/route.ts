/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/drizzle/db';
import { users, tenants } from '@/drizzle/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { withAuthLookupContext } from '@/lib/db/rls';
import { logError } from '@/lib/errors-server';
import { redactEmail } from '@/lib/logger/pii';

interface TelegramMessage {
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

/**
 * #1295: send a Telegram reply and surface failures instead of swallowing them.
 * Previously this fired the fetch without awaiting, so Telegram rate-limits
 * (HTTP 429) and network errors failed silently. Callers now await this so a
 * failed send is logged via the structured error logger. The 10s AbortSignal
 * timeout keeps the webhook responsive — the request still returns 200 promptly
 * after (at most) a single bounded send attempt.
 */
async function sendReply(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Telegram returns 429 with a retry_after when rate-limited. Log the
      // status so throttling/formatting failures are observable, not silent.
      await logError({
        error: new Error(`Telegram sendMessage failed: HTTP ${res.status}`),
        context: 'telegram-bot:sendReply',
        level: 'warning',
        metadata: { status: res.status },
      });
    }
  } catch (e) {
    await logError({
      error: e,
      context: 'telegram-bot:sendReply',
      level: 'warning',
    });
  }
}

/**
 * #1296: escape Telegram Markdown (legacy `parse_mode: 'Markdown'`) special
 * characters in dynamic/user-controlled values. Unescaped `*`, `_`, `` ` `` or
 * `[` in a name/slug/email breaks message formatting — and Telegram rejects the
 * whole message if the resulting Markdown is malformed. Only these four
 * characters are special in legacy Markdown mode.
 */
function mdEscape(value: unknown): string {
  return String(value ?? '').replace(/([_*`[])/g, '\\$1');
}

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false });

  // Fail-closed: require TELEGRAM_WEBHOOK_SECRET and matching
  // X-Telegram-Bot-Api-Secret-Token header (set via setWebhook secret_token).
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    void logError({ error: 'TELEGRAM_WEBHOOK_SECRET is not set; rejecting webhook request', context: 'webhooks/telegram/bot misconfig', level: 'warning' });
    return NextResponse.json({ error: 'telegram secret not configured' }, { status: 403 });
  }

  const providedToken = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const expectedBuf = Buffer.from(webhookSecret, 'utf8');
  const providedBuf = Buffer.from(providedToken, 'utf8');

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: TelegramMessage = await readJsonBody(req);
  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim() || '';

  if (!chatId || !text) return NextResponse.json({ ok: true });

  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  const isAdmin = adminChatId === String(chatId);

  let user: { id: string; email: string; fullName: string | null; isSuperAdmin: boolean | null; telegramEnabled: boolean | null } | undefined;

  // #3316: the sender is resolved from Telegram's `chat.id`, which is a claim until a row answers to
  // it — and on the pool it never did. `lib/db/pool.ts` clears every `app.*` GUC on acquire and on
  // release, and all three of `users`' SELECT arms (0088) key on one of them, so both reads below
  // matched zero rows for every chat id, forever. `withAuthLookupContext` is the SELECT-only privilege
  // that exists for exactly this pre-auth identity read — the same one `app/api/auth/forgot-password`
  // (#3288) and `lib/auth/password-reset.ts` use for the email lookup.
  const lookupColumns = {
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    isSuperAdmin: users.isSuperAdmin,
    telegramEnabled: users.telegramEnabled,
  };

  if (isAdmin) {
    const [adminUser] = await withAuthLookupContext((tx) =>
      tx
        .select(lookupColumns)
        .from(users)
        .where(eq(users.isSuperAdmin, true))
        .limit(1),
    );

    if (!adminUser) {
      // Ask 2: this read is what is supposed to *prove* the sender is the platform operator. Proving
      // nothing is a refusal, not a licence to answer from a synthetic identity — the placeholder this
      // branch used to fall back through ran `/tenants`, `/pending`, `/recent` and `/stats` as a user
      // who exists in no table and can therefore be attributed to nobody in the audit trail.
      void logError({
        error: 'Telegram webhook: no super-admin row resolved for the configured operator chat; admin commands refused',
        context: 'webhooks/telegram/bot operator lookup',
        level: 'warning',
      });
      await sendReply(chatId, 'Operator identity could not be verified — this chat is not linked to a super-admin account.');
      return NextResponse.json({ ok: true });
    }

    user = adminUser;
  } else {
    const [matched] = await withAuthLookupContext((tx) =>
      tx
        .select(lookupColumns)
        .from(users)
        .where(eq(users.telegramChatId, String(chatId)))
        .limit(1),
    );

    user = matched;
  }

  if (!user) {
    await sendReply(chatId, `Hello! I'm NuCRM Bot.\n\nTo link your account:\n1. Go to Settings → Telegram in NuCRM\n2. Enter your bot token and chat ID\n3. Save and message me /start again`);
    return NextResponse.json({ ok: true });
  }

  if (!user.telegramEnabled && !isAdmin) {
    await sendReply(chatId, 'Your Telegram is not enabled. Go to Settings → Telegram in NuCRM to enable it.');
    return NextResponse.json({ ok: true });
  }

  const cmd = (text.split(' ')[0] || '').toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    let msg = `*Welcome, ${mdEscape(user.fullName)}!*\n\nCommands:\n/info — Your account info\n`;
    if (user.isSuperAdmin) {
      msg += `/tenants — List all tenants\n/pending — Pending/approval tenants\n/recent — Recent signups (7d)\n/stats — Platform stats\n`;
    }
    await sendReply(chatId, msg);
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/info') {
    // #1297: do NOT echo the user's email into the outbound Telegram message.
    // Telegram's servers (and any bot infrastructure in between) may log the
    // message body, so the raw email would leak PII off-platform. The chat is
    // already bound to a linked account, so a non-identifying reference is
    // enough here.
    let msg = `*Account Info*\nName: ${mdEscape(user.fullName)}\nEmail: linked to your account`;
    if (user.isSuperAdmin) msg += `\nRole: Super Admin`;
    await sendReply(chatId, msg);
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/tenants' && user.isSuperAdmin) {
    const all = await db.select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      planId: tenants.planId,
      status: tenants.status,
    })
      .from(tenants)
      .orderBy(tenants.createdAt)
      .limit(20);

    if (all.length === 0) {
      await sendReply(chatId, 'No tenants found.');
    } else {
      let msg = `*Tenants (${all.length})*\n\n`;
      for (const t of all) {
        msg += `• ${mdEscape(t.name)} (\`${mdEscape(t.slug)}\`) — ${t.planId} [${t.status}]\n`;
      }
      if (all.length >= 20) msg += '\n_Limited to first 20_';
      await sendReply(chatId, msg);
    }
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/pending' && user.isSuperAdmin) {
    const pending = await db.select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      billingEmail: tenants.billingEmail,
      createdAt: tenants.createdAt,
    })
      .from(tenants)
      .where(sql`${tenants.status} = 'pending' OR ${tenants.status} IS NULL`)
      .orderBy(desc(tenants.createdAt))
      .limit(10);

    if (pending.length === 0) {
      await sendReply(chatId, 'No pending tenants.');
    } else {
      let msg = `*Pending Tenants (${pending.length})*\n\n`;
      for (const t of pending) {
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : 'N/A';
        msg += `• ${mdEscape(t.name)} (\`${mdEscape(t.slug)}\`)\n  Email: ${mdEscape(redactEmail(t.billingEmail))} | Created: ${date}\n`;
      }
      await sendReply(chatId, msg);
    }
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/recent' && user.isSuperAdmin) {
    const recent = await db.select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      planId: tenants.planId,
      status: tenants.status,
      createdAt: tenants.createdAt,
    })
      .from(tenants)
      .where(sql`${tenants.createdAt} > now() - interval '7 days'`)
      .orderBy(desc(tenants.createdAt))
      .limit(10);

    if (recent.length === 0) {
      await sendReply(chatId, 'No signups in the last 7 days.');
    } else {
      let msg = `*Recent Signups (7d)*\n\n`;
      for (const t of recent) {
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : 'N/A';
        msg += `• ${mdEscape(t.name)} (\`${mdEscape(t.slug)}\`) — ${date}\n  Plan: ${t.planId} [${t.status}]\n`;
      }
      await sendReply(chatId, msg);
    }
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/stats' && user.isSuperAdmin) {
    const [tenantRow] = await db.select({
      tenantCount: sql<number>`count(distinct ${tenants.id})`,
    }).from(tenants);

    const [activeRow] = await db.select({
      activeCount: sql<number>`count(*)`,
    }).from(tenants).where(eq(tenants.status, 'active'));

    const [pendingRow] = await db.select({
      pendingCount: sql<number>`count(*)`,
    }).from(tenants).where(sql`${tenants.status} = 'pending' OR ${tenants.status} IS NULL`);

    const [recentRow] = await db.select({
      recentCount: sql<number>`count(*)`,
    }).from(tenants).where(sql`${tenants.createdAt} > now() - interval '7 days'`);

    await sendReply(chatId, `*Platform Stats*\nTotal Tenants: ${tenantRow?.tenantCount ?? 0}\nActive: ${activeRow?.activeCount ?? 0}\nPending: ${pendingRow?.pendingCount ?? 0}\nNew (7d): ${recentRow?.recentCount ?? 0}`);
    return NextResponse.json({ ok: true });
  }

  await sendReply(chatId, `Unknown command: ${cmd}\nSend /help for available commands.`);
  return NextResponse.json({ ok: true });
}

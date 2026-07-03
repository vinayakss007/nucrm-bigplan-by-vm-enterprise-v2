import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, tenants } from '@/drizzle/schema';
import { eq, sql, desc } from 'drizzle-orm';

interface TelegramMessage {
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

function sendReply(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  }).catch(() => {});
}

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false });

  const body: TelegramMessage = await req.json();
  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim() || '';

  if (!chatId || !text) return NextResponse.json({ ok: true });

  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  const isAdmin = adminChatId === String(chatId);

  let user: { id: string; email: string; fullName: string; isSuperAdmin: boolean; telegramEnabled: boolean | null } | undefined;

  if (isAdmin) {
    const [adminUser] = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isSuperAdmin: users.isSuperAdmin,
      telegramEnabled: users.telegramEnabled,
    })
      .from(users)
      .where(eq(users.isSuperAdmin, true))
      .limit(1);

    user = adminUser || {
      id: 'cli-admin',
      email: 'admin@nucrm.local',
      fullName: 'Super Admin',
      isSuperAdmin: true,
      telegramEnabled: true,
    };
  } else {
    const [matched] = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isSuperAdmin: users.isSuperAdmin,
      telegramEnabled: users.telegramEnabled,
    })
      .from(users)
      .where(eq(users.telegramChatId, String(chatId)))
      .limit(1);

    user = matched;
  }

  if (!user) {
    sendReply(chatId, `Hello! I'm NuCRM Bot.\n\nTo link your account:\n1. Go to Settings → Telegram in NuCRM\n2. Enter your bot token and chat ID\n3. Save and message me /start again`);
    return NextResponse.json({ ok: true });
  }

  if (!user.telegramEnabled && !isAdmin) {
    sendReply(chatId, 'Your Telegram is not enabled. Go to Settings → Telegram in NuCRM to enable it.');
    return NextResponse.json({ ok: true });
  }

  const cmd = text.split(' ')[0].toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    let msg = `*Welcome, ${user.fullName}!*\n\nCommands:\n/info — Your account info\n`;
    if (user.isSuperAdmin) {
      msg += `/tenants — List all tenants\n/pending — Pending/approval tenants\n/recent — Recent signups (7d)\n/stats — Platform stats\n`;
    }
    sendReply(chatId, msg);
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/info') {
    let msg = `*Account Info*\nName: ${user.fullName}\nEmail: ${user.email}`;
    if (user.isSuperAdmin) msg += `\nRole: Super Admin`;
    sendReply(chatId, msg);
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
      sendReply(chatId, 'No tenants found.');
    } else {
      let msg = `*Tenants (${all.length})*\n\n`;
      for (const t of all) {
        msg += `• ${t.name} (\`${t.slug}\`) — ${t.planId} [${t.status}]\n`;
      }
      if (all.length >= 20) msg += '\n_Limited to first 20_';
      sendReply(chatId, msg);
    }
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/pending' && user.isSuperAdmin) {
    const pending = await db.select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      email: tenants.email,
      createdAt: tenants.createdAt,
    })
      .from(tenants)
      .where(sql`${tenants.status} = 'pending' OR ${tenants.status} IS NULL`)
      .orderBy(desc(tenants.createdAt))
      .limit(10);

    if (pending.length === 0) {
      sendReply(chatId, 'No pending tenants.');
    } else {
      let msg = `*Pending Tenants (${pending.length})*\n\n`;
      for (const t of pending) {
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : 'N/A';
        msg += `• ${t.name} (\`${t.slug}\`)\n  Email: ${t.email || 'N/A'} | Created: ${date}\n`;
      }
      sendReply(chatId, msg);
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
      sendReply(chatId, 'No signups in the last 7 days.');
    } else {
      let msg = `*Recent Signups (7d)*\n\n`;
      for (const t of recent) {
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : 'N/A';
        msg += `• ${t.name} (\`${t.slug}\`) — ${date}\n  Plan: ${t.planId} [${t.status}]\n`;
      }
      sendReply(chatId, msg);
    }
    return NextResponse.json({ ok: true });
  }

  if (cmd === '/stats' && user.isSuperAdmin) {
    const [{ tenantCount }] = await db.select({
      tenantCount: sql<number>`count(distinct ${tenants.id})`,
    }).from(tenants);

    const [{ activeCount }] = await db.select({
      activeCount: sql<number>`count(*)`,
    }).from(tenants).where(eq(tenants.status, 'active'));

    const [{ pendingCount }] = await db.select({
      pendingCount: sql<number>`count(*)`,
    }).from(tenants).where(sql`${tenants.status} = 'pending' OR ${tenants.status} IS NULL`);

    const [{ recentCount }] = await db.select({
      recentCount: sql<number>`count(*)`,
    }).from(tenants).where(sql`${tenants.createdAt} > now() - interval '7 days'`);

    sendReply(chatId, `*Platform Stats*\nTotal Tenants: ${tenantCount}\nActive: ${activeCount}\nPending: ${pendingCount}\nNew (7d): ${recentCount}`);
    return NextResponse.json({ ok: true });
  }

  sendReply(chatId, `Unknown command: ${cmd}\nSend /help for available commands.`);
  return NextResponse.json({ ok: true });
}

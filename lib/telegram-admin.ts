import { sendTelegram } from '@/lib/email/service';

function getAdminChat(): { botToken: string; chatId: string } | null {
  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '';
  const chatId = process.env['TELEGRAM_CHAT_ID'] || '';
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export async function sendAdminTelegram(opts: {
  title: string;
  message: string;
  icon?: string;
  url?: string;
}): Promise<void> {
  const admin = getAdminChat();
  if (!admin) return;
  await sendTelegram({
    botToken: admin.botToken,
    chatId: admin.chatId,
    title: opts.title,
    message: opts.message,
    icon: opts.icon,
    url: opts.url,
  }).catch(() => {});
}

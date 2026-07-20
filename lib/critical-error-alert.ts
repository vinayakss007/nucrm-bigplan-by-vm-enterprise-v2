import { sendPagerDutyAlert } from '@/lib/pagerduty';
import { sendWebhookNotification } from '@/lib/email/service';
import { sendAdminTelegram } from '@/lib/telegram-admin';

const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, number>();

function isRateLimited(errorMessage: string): boolean {
  const key = errorMessage.slice(0, 100);
  const now = Date.now();
  const lastSent = rateLimitMap.get(key);
  if (lastSent && now - lastSent < RATE_LIMIT_WINDOW_MS) return true;
  rateLimitMap.set(key, now);
  return false;
}

function truncateStack(stack: string, maxLines = 10): string {
  const lines = stack.split('\n');
  if (lines.length <= maxLines) return stack;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

/**
 * Dispatch a critical error alert to ALL configured channels:
 * 1. Generic webhook (CRITICAL_ERROR_WEBHOOK_URL)
 * 2. Discord / Slack (DISCORD_WEBHOOK_URL, SLACK_WEBHOOK_URL)
 * 3. PagerDuty (PAGERDUTY_ROUTING_KEY) — creates incident on "critical", alert otherwise
 * 4. Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
 *
 * Each channel fires independently — one failure does not block the others.
 */
export async function sendCriticalErrorAlert(opts: {
  error: unknown;
  level?: string;
  context?: string;
}): Promise<void> {
  const message =
    opts.error instanceof Error ? opts.error.message : String(opts.error ?? 'Unknown error');

  if (isRateLimited(message)) return;

  const stack = opts.error instanceof Error ? opts.error.stack : undefined;
  const timestamp = new Date().toISOString();
  const environment = process.env.NODE_ENV ?? 'development';
  const level = opts.level ?? 'fatal';

  const payload = {
    event: 'critical_error',
    level,
    message,
    stack_trace: stack ? truncateStack(stack) : undefined,
    timestamp,
    environment,
    context: opts.context,
    service: 'nucrm-enterprise',
  };

  // Fire ALL channels concurrently, catching each independently
  const channelErrors: string[] = [];

  // 1. Generic webhook
  const webhookUrl = process.env.CRITICAL_ERROR_WEBHOOK_URL;
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => channelErrors.push('webhook'));
  }

  // 2. Discord + Slack (sendWebhookNotification dispatches to both)
  sendWebhookNotification({
    title: `🚨 Critical Error (${level})`,
    message: `**${message}**\nContext: ${opts.context ?? 'N/A'}\nEnvironment: ${environment}`,
    color: '#dc2626',
  }).catch(() => channelErrors.push('discord-slack'));

  // 3. PagerDuty
  sendPagerDutyAlert({
    summary: `[${environment}] Critical error: ${message}`,
    severity: level === 'fatal' ? 'critical' : 'error',
    source: `nucrm-${environment}`,
    component: opts.context ?? 'unknown',
    group: 'critical-errors',
    details: {
      message,
      stack_trace: stack ? truncateStack(stack) : undefined,
      context: opts.context,
      level,
    },
  }).catch(() => channelErrors.push('pagerduty'));

  // 4. Telegram
  sendAdminTelegram({
    icon: '🚨',
    title: `Critical Error (${level})`,
    message: `*${message}*\nContext: ${opts.context ?? 'N/A'}\nEnvironment: ${environment}`,
  }).catch(() => channelErrors.push('telegram'));

  // Wait briefly for in-flight requests (best-effort — don't block caller)
  await new Promise((r) => setTimeout(r, 1_000));

  if (channelErrors.length > 0) {
    console.error(
      `[critical-error-alert] Some channels failed: ${channelErrors.join(', ')}`,
    );
  }
}

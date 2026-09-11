/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { escapeHtml } from '@/lib/email/escape-html';
import { generateUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import type * as Nodemailer from 'nodemailer';

/**
 * A single file attachment for an outgoing email.
 * `content` may be a Node Buffer (raw bytes) or a base64-encoded string; each
 * provider adapter converts it into the shape that provider's API expects.
 */
export interface EmailAttachment {
  filename: string;
  /** Raw bytes as a Buffer, or a base64-encoded string. */
  content: Buffer | string;
  contentType?: string;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  /** When set, RFC 8058 List-Unsubscribe headers are added to the message */
  contactId?: string;
  /** Optional file attachments; wired per-provider by each adapter. */
  attachments?: EmailAttachment[];
}

/**
 * Normalize an attachment's content to a base64 string for JSON HTTP APIs.
 * A Buffer is base64-encoded; a string is assumed to be base64 already and
 * passed through unchanged (so callers can supply pre-encoded content).
 */
function toBase64(content: Buffer | string): string {
  return Buffer.isBuffer(content) ? content.toString('base64') : content;
}

export interface SendResult {
  success: boolean;
  provider?: string;
  messageId?: string;
  error?: string;
}

/**
 * Build RFC 8058 compliant List-Unsubscribe and List-Unsubscribe-Post headers.
 * The unsubscribe URL uses an HMAC token so contacts cannot forge unsub requests.
 */
export function buildUnsubscribeHeaders(contactId: string): {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': string;
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nucrm.io';
  // Shared helper resolves UNSUBSCRIBE_SECRET || NEXTAUTH_SECRET and throws if
  // neither is set, so the sign side and the /api/unsubscribe verify side can
  // never drift.
  const token = generateUnsubscribeToken(contactId);
  const unsubUrl = `${appUrl}/api/unsubscribe?contact=${encodeURIComponent(contactId)}&token=${token}`;
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function getFromAddress(): string {
  const name = process.env.SMTP_FROM_NAME ?? 'NuCRM';
  const email = process.env.SMTP_FROM_EMAIL ?? 'noreply@nucrm.io';
  return `${name} <${email}>`;
}

async function sendViaResend(payload: EmailPayload): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { success: false, error: 'RESEND_API_KEY not set' };

  try {
    // Build RFC 8058 List-Unsubscribe headers when contactId is present
    const headers: Record<string, string> = {};
    if (payload.contactId) {
      const unsubHeaders = buildUnsubscribeHeaders(payload.contactId);
      Object.assign(headers, unsubHeaders);
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: payload.from ?? getFromAddress(),
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        // Resend HTTP API accepts attachments: [{ filename, content }] with
        // base64-encoded content. Only include the key when we actually have
        // attachments so bodies stay byte-for-byte unchanged otherwise.
        attachments: payload.attachments && payload.attachments.length > 0
          ? payload.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content),
              ...(a.contentType ? { content_type: a.contentType } : {}),
            }))
          : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json() as { id?: string; message?: string };
    if (res.ok) {
      return { success: true, provider: 'resend', messageId: data.id };
    }
    return { success: false, error: data.message ?? `HTTP ${res.status}` };
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Cache transporter to avoid recreating it on every email send
// cache key includes the password (sha256) so credential rotation
// creates a fresh transporter instead of reusing one with stale auth.
let smtpTransporter: Nodemailer.Transporter | null = null;
let smtpConfig: string | null = null;

async function sendViaSMTP(payload: EmailPayload): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  if (!host) return { success: false, error: 'SMTP_HOST not set' };

  try {
    // Dynamic import to avoid loading nodemailer in non-email paths
    const nodemailer = await import('nodemailer');
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const secure = port === 465;

    // Reuse transporter only when host|port|user|pass unchanged
    const currentConfig = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        host,
        port,
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? ''
      }))
      .digest('hex');

    if (!smtpTransporter || smtpConfig !== currentConfig) {
      const auth = process.env.SMTP_USER || process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined;

      smtpTransporter = nodemailer.default.createTransport({
        host,
        port,
        secure,
        ...(auth ? { auth } : {}),
      });
      smtpConfig = currentConfig;
    }

    const toAddr = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;

    // Build RFC 8058 List-Unsubscribe headers when contactId is present
    const smtpHeaders: Record<string, string> = {};
    if (payload.contactId) {
      const unsubHeaders = buildUnsubscribeHeaders(payload.contactId);
      Object.assign(smtpHeaders, unsubHeaders);
    }

    const info = await smtpTransporter.sendMail({
      from: payload.from ?? getFromAddress(),
      to: toAddr,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      replyTo: payload.replyTo,
      headers: Object.keys(smtpHeaders).length > 0 ? smtpHeaders : undefined,
      // nodemailer accepts attachments: [{ filename, content, contentType }]
      // with the Buffer/string content passed through directly (no base64
      // conversion needed). Only set the key when non-empty.
      attachments: payload.attachments && payload.attachments.length > 0
        ? payload.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType ? { contentType: a.contentType } : {}),
          }))
        : undefined,
    });

    return { success: true, provider: 'smtp', messageId: info.messageId };
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * True when at least one real email provider (Resend or SMTP) is configured.
 * Health checks and callers can use this to surface the gap up front instead of
 * discovering it only when a password-reset silently fails (#1041).
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

/** Which email provider will actually be used, for diagnostics/health. */
export function getEmailProviderStatus(): {
  configured: boolean;
  provider: 'resend' | 'smtp' | 'console (dev)' | 'none';
} {
  if (process.env.RESEND_API_KEY) return { configured: true, provider: 'resend' };
  if (process.env.SMTP_HOST) return { configured: true, provider: 'smtp' };
  if (process.env.NODE_ENV !== 'production') return { configured: false, provider: 'console (dev)' };
  return { configured: false, provider: 'none' };
}

/**
 * Send an email using whichever provider is configured.
 * Tries Resend first, falls back to SMTP.
 * In development with no provider configured, logs to console.
 *
 * #1041: email failures must NOT be silent. When no provider is configured in
 * production, or when every configured provider fails, we record a structured
 * error (errorLogs + Sentry via logError) so the gap is observable in the
 * dashboard instead of password resets/invites vanishing without a trace.
 */
export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const recipients = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;

  // Try Resend first
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend(payload);
    if (result.success) return result;
    console.warn('[email] Resend failed, trying SMTP fallback:', result.error);

    // If Resend was the only provider, this is a hard failure — make it loud.
    if (!process.env.SMTP_HOST) {
      await reportEmailFailure(`Resend send failed: ${result.error}`, payload.subject, recipients);
      return result;
    }
  }

  // Try SMTP
  if (process.env.SMTP_HOST) {
    const result = await sendViaSMTP(payload);
    if (!result.success) {
      await reportEmailFailure(`SMTP send failed: ${result.error}`, payload.subject, recipients);
    }
    return result;
  }

  // Development fallback - log to console
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n📧 [DEV EMAIL - not sent]\nTo: ${recipients}\nSubject: ${payload.subject}\n`);
    return { success: true, provider: 'console (dev)' };
  }

  // Production with NO provider configured — the exact #1041 scenario. Loudly
  // record it rather than returning a result the caller may ignore.
  await reportEmailFailure(
    'No email provider configured (set RESEND_API_KEY or SMTP_HOST). Email was NOT sent.',
    payload.subject,
    recipients,
  );
  return {
    success: false,
    error: 'No email provider configured. Set RESEND_API_KEY or SMTP_HOST in your environment.',
  };
}

/** Record an email failure to the structured error log (best-effort, never throws). */
async function reportEmailFailure(reason: string, subject: string, recipients: string): Promise<void> {
  logger.error('[email] send failure', { reason, subject });
  try {
    const { logError } = await import('@/lib/errors-server');
    const { redactEmail } = await import('@/lib/logger/pii');
    const redacted = recipients
      .split(',')
      .map((r) => redactEmail(r.trim()))
      .join(', ');
    await logError({
      error: new Error(reason),
      context: 'email:send-failure',
      level: 'error',
      metadata: { subject, recipients: redacted },
    });
  } catch {
    // logging must never break the send path
  }
}

/** Render a simple template string with {{variable}} placeholders */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Render a template with {{variable}} placeholders, HTML-escaping each value (for HTML bodies) */
export function renderTemplateHtml(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(vars[key] ?? ''));
}

/** Send super admin alert for cron job failures */
export async function alertSuperAdmin(subject: string, message: string) {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) return;
  await sendEmail({
    to: adminEmail,
    subject: `[NuCRM Alert] ${subject}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
      <h3 style="color:#dc2626;margin:0 0 12px">${subject}</h3>
      <pre style="background:#f3f4f6;padding:16px;border-radius:8px;font-size:13px;white-space:pre-wrap">${message}</pre>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px">Sent from NuCRM monitoring</p>
    </div>`,
    text: `${subject}\n\n${message}`,
  }).catch((e) => logger.error('[Email] Failed to send admin alert', { error: e instanceof Error ? e.message : String(e) }));
}

/**
 * Send notification via Discord/Slack webhook (free, no email needed)
 * Set DISCORD_WEBHOOK_URL or SLACK_WEBHOOK_URL in env vars
 */
export async function sendWebhookNotification(opts: {
  title: string;
  message: string;
  color?: string;
  url?: string;
}) {
  const { title, message, color = '#7c3aed', url } = opts;
  const timestamp = new Date().toISOString();

  // Discord webhook
  const discordUrl = process.env['DISCORD_WEBHOOK_URL'];
  if (discordUrl) {
    try {
      await fetch(discordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title,
            description: message,
            color: parseInt(color.replace('#', ''), 16),
            url,
            footer: { text: 'NuCRM' },
            timestamp,
          }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      logger.error('[webhook] Discord failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Slack webhook
  const slackUrl = process.env['SLACK_WEBHOOK_URL'];
  if (slackUrl) {
    try {
      const slackColor = color.replace('#', '');
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: title } },
            { type: 'section', text: { type: 'mrkdwn', text: message } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `*NuCRM* | ${timestamp}` }] },
          ],
          attachments: [{ color: `#${slackColor}` }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      logger.error('[webhook] Slack failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/**
 * Send notification via Telegram Bot
 * Users configure their own bot token + chat ID
 * Setup: @BotFather → /newbot → get token → /start bot → get chat ID via @userinfobot
 */
export async function sendTelegram(opts: {
  botToken: string;
  chatId: string;
  title: string;
  message: string;
  icon?: string;
  url?: string;
}) {
  const { botToken, chatId, title, message, icon = '🔔', url } = opts;
  if (!botToken || !chatId) return;

  const text = `${icon} *${title}*\n\n${message}${url ? `\n\n🔗 [Open](${url})` : ''}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ description: `HTTP ${res.status}` }));
      logger.error('[telegram] Failed', { reason: data.description || res.status });
    }
  } catch (err) {
    logger.error('[telegram] Error', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Send Telegram notification to a user if they have Telegram configured
 */
export async function sendTelegramToUser(opts: {
  userId: string;
  title: string;
  message: string;
  icon?: string;
  url?: string;
  eventType?: 'login' | 'signup' | 'password_change' | '2fa_change' | 'security_alert';
}) {
  try {
    const { db } = await import('@/drizzle/db');
    const { users } = await import('@/drizzle/schema');
    const { eq } = await import('drizzle-orm');

    const user = await db.query.users.findFirst({
      where: eq(users.id, opts.userId),
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

    // Check if Telegram is enabled
    if (!user?.telegramEnabled) return;
    if (!user.telegramBotToken || !user.telegramChatId) return;

    // Check if this event type is enabled for the user
    const eventPrefs: Record<string, boolean | null> = {
      login: user.telegramNotifyLogin,
      signup: user.telegramNotifySignup,
      password_change: user.telegramNotifyPasswordChange,
      '2fa_change': user.telegramNotify2faChange,
      security_alert: user.telegramNotifySecurityAlerts,
    };

    // If eventType specified, check preference; otherwise send
    if (opts.eventType && !eventPrefs[opts.eventType]) return;

    await sendTelegram({
      botToken: user.telegramBotToken,
      chatId: user.telegramChatId,
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      url: opts.url,
    });
  } catch (err) {
    logger.error('[telegram] Failed to send to user', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Create email tracking for open/click tracking */
export async function createEmailTracking(data: {
  tenantId: string;
  contactId: string;
  recipient: string;
  subject: string;
  sequenceEnrollmentId?: string;
  bodyText?: string;
}): Promise<string | null> {
  try {
    const { db } = await import('@/drizzle/db');
    const { emailTracking } = await import('@/drizzle/schema');
    const trackingId = crypto.randomUUID();
    
    await db.insert(emailTracking).values({
      id: trackingId,
      tenantId: data.tenantId,
      contactId: data.contactId,
      recipient: data.recipient,
      subject: data.subject,
      sequenceEnrollmentId: data.sequenceEnrollmentId || null,
    });

    // Analyze sentiment from email subject/body and update contact's deals
    const textToAnalyze = data.bodyText ? `${data.subject}\n\n${data.bodyText}` : data.subject;
    if (textToAnalyze.trim()) {
      const { analyzeSentimentForContact } = await import('@/lib/ai/sentiment');
      analyzeSentimentForContact(data.contactId, data.tenantId, textToAnalyze.slice(0, 2000)).catch((err: unknown) => {
        logger.error('[email] Sentiment analysis failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }
    
    return trackingId;
  } catch (err) {
    logger.error('[email] Failed to create tracking', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Add tracking pixel and link tracking to HTML */
export function addTracking(html: string, trackingId: string, appUrl: string): string {
  const trackingPixel = `<img src="${appUrl}/api/email/track/open?id=${trackingId}" width="1" height="1" style="display:none" />`;
  return html.replace('</body>', `${trackingPixel}</body>`);
}

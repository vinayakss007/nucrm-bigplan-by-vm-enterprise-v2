/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Multi-Provider Email Router
 * 
 * Routes emails through different providers based on:
 * - Email type (critical vs marketing)
 * - Daily/monthly limits
 * - Provider health
 * 
 * Free Tier Limits:
 * - Resend: 3,000/month (100/day average)
 * - Brevo: 9,000/month (300/day)
 * - SendGrid: 3,000/month (100/day)
 * 
 * Usage:
 * import { sendSmartEmail } from '@/lib/email/router';
 * 
 * await sendSmartEmail({
 *   to: 'user@example.com',
 *   type: 'critical', // or 'marketing', 'bulk'
 *   subject: 'Verify your email',
 *   html: '...'
 * });
 */

import { logger } from '@/lib/logger';

/**
 * A single file attachment. `content` may be a Node Buffer (raw bytes) or a
 * base64-encoded string; each provider adapter serializes it to that provider's
 * required JSON shape.
 */
interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  type?: 'critical' | 'transactional' | 'marketing' | 'bulk';
  from?: string;
  /** Optional file attachments; serialized per-provider by each adapter. */
  attachments?: EmailAttachment[];
}

/**
 * Normalize an attachment's content to a base64 string for JSON HTTP APIs.
 * A Buffer is base64-encoded; a string is assumed to be base64 already and
 * passed through unchanged.
 */
function toBase64(content: Buffer | string): string {
  return Buffer.isBuffer(content) ? content.toString('base64') : content;
}

/** Error thrown when provider fallback routing exceeds its depth limit. */
export class EmailRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailRoutingError';
  }
}

// Internal option: number of fallback hops already taken (loop guard)
type SendOptions = EmailOptions & { _depth?: number };
const MAX_FALLBACK_HOPS = 3;

interface ProviderStats {
  name: string;
  sentToday: number;
  sentThisMonth: number;
  dailyLimit: number;
  monthlyLimit: number;
  healthy: boolean;
  lastError?: string;
}

// Provider configurations
const PROVIDERS = {
  resend: {
    name: 'Resend',
    apiKey: process.env.RESEND_API_KEY,
    dailyLimit: 100,
    monthlyLimit: 3000,
    priority: 1, // Highest priority for critical emails
  },
  brevo: {
    name: 'Brevo',
    apiKey: process.env['BREVO_API_KEY'],
    smtpHost: process.env['BREVO_SMTP_HOST'],
    smtpPort: process.env['BREVO_SMTP_PORT'],
    smtpUser: process.env['BREVO_SMTP_USER'],
    smtpPass: process.env['BREVO_SMTP_PASS'],
    dailyLimit: 300,
    monthlyLimit: 9000,
    priority: 2,
  },
  sendgrid: {
    name: 'SendGrid',
    apiKey: process.env['SENDGRID_API_KEY'],
    dailyLimit: 100,
    monthlyLimit: 3000,
    priority: 3,
  },
};

// Track usage (in production, use database/Redis)
const usage = new Map<string, ProviderStats>();

/** Timestamp of the last daily reset (used to auto-reset stale counters) */
let lastDailyReset = Date.now();

function initializeUsage() {
  Object.entries(PROVIDERS).forEach(([key, config]) => {
    usage.set(key, {
      name: config.name,
      sentToday: 0,
      sentThisMonth: 0,
      dailyLimit: config.dailyLimit,
      monthlyLimit: config.monthlyLimit,
      healthy: true,
    });
  });
  lastDailyReset = Date.now();
}

// Initialize on first load
initializeUsage();

/**
 * Auto-reset daily counters if a new day has started since the last reset.
 * Prevents stale counters from accumulating if resetDailyCounters() is
 * never called externally (e.g., missing cron).
 */
function ensureDailyReset(): void {
  const now = Date.now();
  const ONE_DAY_MS = 86_400_000;
  if (now - lastDailyReset >= ONE_DAY_MS) {
    usage.forEach((stats) => {
      stats.sentToday = 0;
    });
    lastDailyReset = now;
  }
}

/**
 * Get best provider for email type
 */
function getBestProvider(emailType: string): string | null {
  // Auto-reset daily counters if a new calendar day has elapsed
  ensureDailyReset();

  const providers = Object.entries(PROVIDERS)
    .filter(([_, config]) => config.apiKey) // Only enabled providers
    .sort((a, b) => a[1].priority - b[1].priority);

  for (const [key, config] of providers) {
    const stats = usage.get(key);
    if (!stats) continue;

    // Check if provider is healthy
    if (!stats.healthy) continue;

    // Check limits
    if (stats.sentToday >= config.dailyLimit) {
      console.log(`[EmailRouter] ${config.name} daily limit reached (${stats.sentToday}/${config.dailyLimit})`);
      continue;
    }

    if (stats.sentThisMonth >= config.monthlyLimit) {
      console.log(`[EmailRouter] ${config.name} monthly limit reached (${stats.sentThisMonth}/${config.monthlyLimit})`);
      continue;
    }

    // For critical emails, use highest priority provider
    if (emailType === 'critical' && config.priority === 1) {
      return key;
    }

    // For other emails, use first available
    return key;
  }

  return null; // No provider available
}

/**
 * Send via Resend
 */
async function sendViaResend(options: EmailOptions) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PROVIDERS.resend.apiKey}`,
    },
    body: JSON.stringify({
      from: options.from || 'NuCRM <onboarding@resend.dev>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      // Resend: attachments: [{ filename, content: base64 }]. Only include
      // the key when non-empty so bodies stay unchanged otherwise.
      attachments: options.attachments && options.attachments.length > 0
        ? options.attachments.map((a) => ({
            filename: a.filename,
            content: toBase64(a.content),
            ...(a.contentType ? { content_type: a.contentType } : {}),
          }))
        : undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend error: ${error}`);
  }

  return res.json();
}

/**
 * Send via Brevo (SMTP)
 */
async function sendViaBrevo(options: EmailOptions) {
  // For now, use API call (implement SMTP in worker if needed)
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': PROVIDERS.brevo.apiKey!,
    },
    body: JSON.stringify({
      sender: { email: options.from || 'noreply@yourdomain.com' },
      to: [{ email: options.to }],
      subject: options.subject,
      htmlContent: options.html,
      textContent: options.text,
      // Brevo v3 uses `attachment: [{ name, content: base64 }]`. Only include
      // the key when non-empty.
      attachment: options.attachments && options.attachments.length > 0
        ? options.attachments.map((a) => ({
            name: a.filename,
            content: toBase64(a.content),
          }))
        : undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Brevo error: ${error}`);
  }

  return res.json();
}

/**
 * Send via SendGrid
 */
async function sendViaSendGrid(options: EmailOptions) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PROVIDERS.sendgrid.apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: options.to }] }],
      from: { email: options.from || 'noreply@yourdomain.com' },
      subject: options.subject,
      content: [{ type: 'text/html', value: options.html }],
      // SendGrid: attachments: [{ filename, content: base64, type, disposition }].
      // Only include the key when non-empty.
      attachments: options.attachments && options.attachments.length > 0
        ? options.attachments.map((a) => ({
            filename: a.filename,
            content: toBase64(a.content),
            ...(a.contentType ? { type: a.contentType } : {}),
            disposition: 'attachment',
          }))
        : undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok && res.status !== 202) {
    const error = await res.text();
    throw new Error(`SendGrid error: ${error}`);
  }

  return { success: true };
}

/**
 * Update provider usage stats
 */
function updateUsage(providerKey: string, success: boolean, error?: string) {
  const stats = usage.get(providerKey);
  if (!stats) return;

  if (success) {
    stats.sentToday++;
    stats.sentThisMonth++;
    stats.healthy = true;
  } else {
    stats.healthy = false;
    stats.lastError = error;
  }
}

/**
 * Smart email sender with multi-provider support
 */
export async function sendSmartEmail(options: SendOptions) {
  const emailType = options.type || 'transactional';
  const depth = options._depth || 0;
  
  console.log(`[EmailRouter] Sending ${emailType} email to ${options.to}`);

  // Get best available provider
  const providerKey = getBestProvider(emailType);
  
  if (!providerKey) {
    const error = 'No email providers available (all at limit or unhealthy)';
    logger.error('[EmailRouter] No provider available', { reason: error });
    
    // Fallback: Log email for later sending
    console.log('[EmailRouter] Queuing email for later delivery...');
    // Queue via DB job (bg worker picks up)
    
    throw new Error(error);
  }

  const provider = PROVIDERS[providerKey as keyof typeof PROVIDERS];
  console.log(`[EmailRouter] Using provider: ${provider.name}`);

  try {
    // Send via selected provider
    let result;
    if (providerKey === 'resend') {
      result = await sendViaResend(options);
    } else if (providerKey === 'brevo') {
      result = await sendViaBrevo(options);
    } else if (providerKey === 'sendgrid') {
      result = await sendViaSendGrid(options);
    } else {
      throw new Error(`Unknown provider: ${providerKey}`);
    }

    updateUsage(providerKey, true);
    console.log(`[EmailRouter] ✓ Email sent via ${provider.name}`);
    
    return { success: true, provider: provider.name, result };
    
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    logger.error('[EmailRouter] provider failed', { provider: provider.name, error: err instanceof Error ? err.message : String(err) });
    updateUsage(providerKey, false, err.message);

    // Try fallback providers for critical emails
    if (emailType === 'critical') {
      console.log('[EmailRouter] Trying fallback providers...');
      
      // Depth guard: never chain more than MAX_FALLBACK_HOPS fallbacks,
      // otherwise a misbehaving provider set could recurse forever.
      if (depth >= MAX_FALLBACK_HOPS) {
        throw new EmailRoutingError('routing loop: exceeded maximum fallback hops');
      }

      // Try next available provider
      const fallback = getBestProvider(emailType);
      if (fallback && fallback !== providerKey) {
        console.log(`[EmailRouter] Falling back to ${PROVIDERS[fallback as keyof typeof PROVIDERS].name}`);
        return sendSmartEmail({ ...options, type: emailType, _depth: depth + 1 });
      }
    }

    throw err;
  }
}

/**
 * Get current usage stats
 */
export function getEmailUsage() {
  const stats: Record<string, ProviderStats> = {};
  usage.forEach((value, key) => {
    stats[key] = value;
  });
  return stats;
}

/**
 * Reset daily counters (call this at midnight)
 */
export function resetDailyCounters() {
  usage.forEach((stats) => {
    stats.sentToday = 0;
  });
  console.log('[EmailRouter] Daily counters reset');
}

/**
 * Reset monthly counters (call this on 1st of month)
 */
export function resetMonthlyCounters() {
  usage.forEach((stats) => {
    stats.sentThisMonth = 0;
  });
  console.log('[EmailRouter] Monthly counters reset');
}

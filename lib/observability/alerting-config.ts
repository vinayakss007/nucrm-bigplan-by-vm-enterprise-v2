/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2542 — "is anything actually listening?" as data.
 *
 * The alerting chain has never delivered an alert (register PP-034: Alertmanager
 * has ~10.8k recorded delivery failures, `CRITICAL_ERROR_WEBHOOK_URL` is unset in
 * the runtime environment) and nothing in the app said so. Every export from
 * `lib/critical-error-alert.ts` degrades silently when its channel is
 * unconfigured: `sendCriticalErrorAlert` fires all channels and collects only
 * the failures it *observed*, so an unset webhook URL is not a failure it can
 * see — it is a channel that was never attempted.
 *
 * The consequence is the failure mode this repo keeps paying for: "monitoring
 * green, nothing monitored". A health endpoint that lists the alert channels it
 * is and is not using makes the gap observable, and makes a marketing claim of
 * 24/7 alerting falsifiable by `curl /api/system/health`.
 *
 * Two rules this module holds to:
 *
 * 1. **A configured flag, never a value.** Nothing here returns the webhook URL,
 *    the bot token or the DSN — a health payload is a page an operator screenshots
 *    into a chat. Only booleans and variable NAMES leave this file.
 * 2. **Enabled is not the same as present.** `PAGERDUTY_ENABLED=false` beside a
 *    routing key is a channel that will not fire, and `SENTRY_DISABLE=true` beside
 *    a DSN is a channel that initialises to nothing. Reporting presence alone
 *    would reproduce the bug it is meant to catch.
 */

export type AlertChannel = 'webhook' | 'discord' | 'slack' | 'pagerduty' | 'telegram' | 'sentry' | 'email';

/**
 * The variables each channel needs, in the order an operator would set them.
 * Exported so the docs and the tests cite one list instead of three copies.
 */
export const ALERT_CHANNEL_ENV: Record<AlertChannel, string[]> = {
  webhook: ['CRITICAL_ERROR_WEBHOOK_URL'],
  discord: ['DISCORD_WEBHOOK_URL'],
  slack: ['SLACK_WEBHOOK_URL'],
  pagerduty: ['PAGERDUTY_ROUTING_KEY', 'PAGERDUTY_ENABLED'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
  sentry: ['SENTRY_DSN', 'SENTRY_DISABLE', 'SENTRY_ENABLE'],
  // Either provider satisfies this channel; see `emailConfigured` below.
  email: ['RESEND_API_KEY', 'SMTP_HOST'],
};

export interface AlertingConfigSummary {
  /**
   * True when at least one channel can reach a human. `sentry` alone does NOT
   * count: a Sentry event is a dashboard nobody is paged by, which is exactly
   * the gap #2542 records (`SENTRY_AUTH_TOKEN` cannot even read issues, #2125).
   */
  configured: boolean;
  /** Channel → can this channel actually fire? Booleans only. */
  channels: Record<AlertChannel, boolean>;
  /** Channel names that cannot fire, so the operator has a to-do list. */
  unconfigured: AlertChannel[];
  /** Variable NAMES that would enable an unconfigured channel. Never values. */
  missingVars: string[];
  /**
   * `degraded` means "nothing pages a human". Non-production is reported as
   * healthy so a laptop without a webhook does not look like a production
   * incident; the `configured: false` flag still tells the truth in both.
   */
  status: 'healthy' | 'degraded';
  /** True when the verdict is held against the production bar (not dev noise). */
  productionExpectation: boolean;
}

type EnvLike = Record<string, string | undefined>;

function isSet(env: EnvLike, name: string): boolean {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '';
}

/** An opt-OUT switch that is on when the variable says `true`. */
function isTrue(env: EnvLike, name: string): boolean {
  return (env[name] ?? '').trim().toLowerCase() === 'true';
}

function isEnabledByFlag(env: EnvLike, name: string): boolean {
  return (env[name] ?? '').trim().toLowerCase() !== 'false';
}

/**
 * The email provider's own answer, injected rather than re-derived: the health
 * endpoint already asks `getEmailProviderStatus()` (#1041), and two independent
 * readings of "is email configured" is how the panel and the sender drifted
 * apart in the first place.
 */
export interface AlertingConfigOptions {
  emailConfigured?: boolean;
  /** Defaults to `env.NODE_ENV === 'production'`. */
  production?: boolean;
}

export function summarizeAlertingConfig(
  env: EnvLike = process.env,
  options: AlertingConfigOptions = {},
): AlertingConfigSummary {
  const production = options.production ?? env['NODE_ENV'] === 'production';

  const channels: Record<AlertChannel, boolean> = {
    webhook: isSet(env, 'CRITICAL_ERROR_WEBHOOK_URL'),
    discord: isSet(env, 'DISCORD_WEBHOOK_URL'),
    slack: isSet(env, 'SLACK_WEBHOOK_URL'),
    // A routing key with the kill switch on is NOT a channel.
    pagerduty: isSet(env, 'PAGERDUTY_ROUTING_KEY') && isEnabledByFlag(env, 'PAGERDUTY_ENABLED'),
    telegram: isSet(env, 'TELEGRAM_BOT_TOKEN') && isSet(env, 'TELEGRAM_CHAT_ID'),
    // The SDK's own gates, in the order they are honoured: SENTRY_DISABLE=false
    // leaves it on, SENTRY_ENABLE=false turns it off.
    sentry:
      isSet(env, 'SENTRY_DSN') &&
      !isTrue(env, 'SENTRY_DISABLE') &&
      isEnabledByFlag(env, 'SENTRY_ENABLE'),
    email: options.emailConfigured ?? (isSet(env, 'RESEND_API_KEY') || isSet(env, 'SMTP_HOST')),
  };

  const humanReachable: AlertChannel[] = ['webhook', 'discord', 'slack', 'pagerduty', 'telegram', 'email'];
  const configured = humanReachable.some((channel) => channels[channel]);

  const unconfigured = (Object.keys(channels) as AlertChannel[]).filter((channel) => !channels[channel]);
  const missingVars = Array.from(
    new Set(unconfigured.flatMap((channel) => ALERT_CHANNEL_ENV[channel])),
  );

  return {
    configured,
    channels,
    unconfigured,
    missingVars,
    status: configured || !production ? 'healthy' : 'degraded',
    productionExpectation: production,
  };
}

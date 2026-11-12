/**
 * #2542 — "no alert has ever been delivered" was invisible from outside the
 * process, because every unconfigured channel simply did not fire. The health
 * endpoint now answers the question, so these assertions are the acceptance
 * criteria for that answer:
 *
 *   - an unconfigured production deployment reports `configured: false` AND
 *     `status: 'degraded'` (the 24/7 claim becomes falsifiable),
 *   - a kill-switched channel (PAGERDUTY_ENABLED=false, SENTRY_DISABLE=true) is
 *     reported as NOT configured — presence is not enabled,
 *   - Sentry alone does not count as "can page a human" (dashboard-only, #2125),
 *   - the payload carries variable NAMES, never values,
 *   - the verdict reaches the endpoint's overall status.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  ALERT_CHANNEL_ENV,
  summarizeAlertingConfig,
} from '@/lib/observability/alerting-config';

const PROD = { NODE_ENV: 'production' } as Record<string, string | undefined>;

describe('#2542 — alerting configuration is reported by the health endpoint', () => {
  describe('an unconfigured deployment', () => {
    it('says so in production, and lists the variables to set', () => {
      const summary = summarizeAlertingConfig({ ...PROD }, { emailConfigured: false });

      expect(summary.configured).toBe(false);
      expect(summary.status).toBe('degraded');
      expect(summary.productionExpectation).toBe(true);
      expect(summary.unconfigured).toEqual(
        expect.arrayContaining(['webhook', 'pagerduty', 'telegram', 'email']),
      );
      expect(summary.missingVars).toEqual(
        expect.arrayContaining([
          'CRITICAL_ERROR_WEBHOOK_URL',
          'PAGERDUTY_ROUTING_KEY',
          'TELEGRAM_BOT_TOKEN',
          'TELEGRAM_CHAT_ID',
        ]),
      );
    });

    it('does not turn a laptop into a production incident, but still reports the truth', () => {
      const summary = summarizeAlertingConfig({ NODE_ENV: 'development' }, { emailConfigured: false });

      expect(summary.configured).toBe(false);
      expect(summary.status).toBe('healthy');
      expect(summary.productionExpectation).toBe(false);
    });
  });

  describe('presence is not enabled', () => {
    it('PAGERDUTY_ENABLED=false beside a routing key is not a channel', () => {
      const summary = summarizeAlertingConfig(
        { ...PROD, PAGERDUTY_ROUTING_KEY: 'k'.repeat(32), PAGERDUTY_ENABLED: 'false' },
        { emailConfigured: false },
      );
      expect(summary.channels.pagerduty).toBe(false);
      expect(summary.configured).toBe(false);
      expect(summary.status).toBe('degraded');
    });

    it('SENTRY_DISABLE=true beside a DSN is not a channel', () => {
      const summary = summarizeAlertingConfig(
        { ...PROD, SENTRY_DSN: 'https://x@y.ingest.sentry.io/1', SENTRY_DISABLE: 'true' },
        { emailConfigured: false },
      );
      expect(summary.channels.sentry).toBe(false);
    });

    it('SENTRY_ENABLE=false beside a DSN is not a channel either', () => {
      const summary = summarizeAlertingConfig(
        { ...PROD, SENTRY_DSN: 'https://x@y.ingest.sentry.io/1', SENTRY_ENABLE: 'false' },
        { emailConfigured: false },
      );
      expect(summary.channels.sentry).toBe(false);
    });

    it('treats whitespace-only values as unset', () => {
      const summary = summarizeAlertingConfig(
        { ...PROD, CRITICAL_ERROR_WEBHOOK_URL: '   ' },
        { emailConfigured: false },
      );
      expect(summary.channels.webhook).toBe(false);
    });

    it('needs both halves of the Telegram pair', () => {
      const half = summarizeAlertingConfig(
        { ...PROD, TELEGRAM_BOT_TOKEN: 'token' },
        { emailConfigured: false },
      );
      expect(half.channels.telegram).toBe(false);

      const full = summarizeAlertingConfig(
        { ...PROD, TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '42' },
        { emailConfigured: false },
      );
      expect(full.channels.telegram).toBe(true);
    });
  });

  describe('what counts as reaching a human', () => {
    it('Sentry alone does not — it is a dashboard, not a page (#2125)', () => {
      const summary = summarizeAlertingConfig(
        { ...PROD, SENTRY_DSN: 'https://x@y.ingest.sentry.io/1' },
        { emailConfigured: false },
      );
      expect(summary.channels.sentry).toBe(true);
      expect(summary.configured).toBe(false);
      expect(summary.status).toBe('degraded');
    });

    it('one webhook is enough to stop the degraded verdict', () => {
      const summary = summarizeAlertingConfig(
        { ...PROD, CRITICAL_ERROR_WEBHOOK_URL: 'https://hooks.example.com/x' },
        { emailConfigured: false },
      );
      expect(summary.configured).toBe(true);
      expect(summary.status).toBe('healthy');
      expect(summary.unconfigured).not.toContain('webhook');
    });

    it('uses the email provider’s own answer instead of re-deriving it', () => {
      const summary = summarizeAlertingConfig(PROD, { emailConfigured: true });
      expect(summary.channels.email).toBe(true);
      expect(summary.configured).toBe(true);
    });
  });

  describe('never a value', () => {
    it('returns booleans and variable names only', () => {
      const secretUrl = 'https://hooks.slack.com/services/T000/B000/SECRET';
      const summary = summarizeAlertingConfig(
        { ...PROD, SLACK_WEBHOOK_URL: secretUrl, TELEGRAM_BOT_TOKEN: 'BOT_SECRET' },
        { emailConfigured: false },
      );

      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain('SECRET');
      expect(serialized).not.toContain('hooks.slack.com');
      expect(serialized).not.toContain('BOT_SECRET');
      // Every channel value is a boolean, not an env string.
      for (const value of Object.values(summary.channels)) {
        expect(typeof value).toBe('boolean');
      }
    });

    it('documents every channel it reports', () => {
      const summary = summarizeAlertingConfig({ ...PROD }, { emailConfigured: false });
      for (const channel of Object.keys(summary.channels)) {
        expect(ALERT_CHANNEL_ENV[channel as keyof typeof ALERT_CHANNEL_ENV]).toBeTruthy();
      }
    });
  });

  describe('wiring — the endpoint reports it', () => {
    const source = readFileSync('app/api/system/health/route.ts', 'utf8');

    it('imports the summary and puts it on the response', () => {
      expect(source).toContain('summarizeAlertingConfig');
      expect(source).toContain('alerting: summarizeAlertingConfig()');
    });

    it('feeds the verdict into the overall status', () => {
      const statusBlock = source.slice(source.indexOf('const statuses = ['));
      expect(statusBlock).toContain('health.alerting.status');
    });

    it('passes the email provider’s answer in rather than reading env twice', () => {
      expect(source).toContain('emailConfigured: health.email.configured');
    });
  });
});

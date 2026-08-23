/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * PagerDuty Events API v2 integration for operator alerting.
 * Uses the /v2/enqueue endpoint — no SDK required.
 *
 * Env vars:
 *   PAGERDUTY_ROUTING_KEY — Integration key (32-char hex) from a PagerDuty Events API v2 integration
 *   PAGERDUTY_ENABLED     — Optional "true"/"false" override (default: auto-detect from routing key)
 *
 * https://developer.pagerduty.com/docs/events-api-v2/overview/
 */

const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export type PagerDutySeverity = 'critical' | 'error' | 'warning' | 'info';

export interface PagerDutyAlertOpts {
  /** Short summary shown in PagerDuty alert */
  summary: string;
  /** Severity: critical triggers an incident, others create alerts */
  severity: PagerDutySeverity;
  /** Logical source of the event (e.g. "nucrm-api", "nucrm-cron") */
  source?: string;
  /** Component name (e.g. "auth", "billing", "email") */
  component?: string;
  /** Group for grouping related alerts (e.g. "database", "rate-limit") */
  group?: string;
  /** Custom details payload (shows in alert JSON) */
  details?: Record<string, unknown>;
  /** Dedup key — alerts with same key are merged (default: auto from summary) */
  dedupKey?: string;
}

function getRoutingKey(): string | null {
  const key = process.env['PAGERDUTY_ROUTING_KEY'] || '';
  if (!key || key.length < 10) return null;
  return key;
}

function isEnabled(): boolean {
  const override = (process.env['PAGERDUTY_ENABLED'] || '').toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  return getRoutingKey() !== null;
}

function defaultDedupKey(summary: string): string {
  // Deterministic dedup from first 64 chars of summary
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 64);
}

/**
 * Send an alert to PagerDuty Events API v2.
 * Returns true on success, false on failure (never throws).
 */
export async function sendPagerDutyAlert(
  opts: PagerDutyAlertOpts,
): Promise<boolean> {
  if (!isEnabled()) return false;

  const routingKey = getRoutingKey();
  if (!routingKey) return false;

  const payload = {
    routing_key: routingKey,
    event_action: 'trigger' as const,
    dedup_key: opts.dedupKey ?? defaultDedupKey(opts.summary),
    payload: {
      summary: opts.summary,
      severity: opts.severity,
      source: opts.source ?? 'nucrm-enterprise',
      component: opts.component ?? 'unknown',
      group: opts.group ?? 'default',
      class: 'nucrm',
      timestamp: new Date().toISOString(),
      custom_details: opts.details ?? {},
    },
  };

  try {
    const res = await fetch(PAGERDUTY_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      console.error(
        `[pagerduty] API returned ${res.status}: ${await res.text().catch(() => 'unknown')}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error('[pagerduty] Failed to send alert:', err);
    return false;
  }
}

/**
 * Resolve (acknowledge) a PagerDuty incident by dedup key.
 */
export async function resolvePagerDutyAlert(dedupKey: string): Promise<boolean> {
  if (!isEnabled()) return false;

  const routingKey = getRoutingKey();
  if (!routingKey) return false;

  try {
    const res = await fetch(PAGERDUTY_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: routingKey,
        event_action: 'acknowledge',
        dedup_key: dedupKey,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

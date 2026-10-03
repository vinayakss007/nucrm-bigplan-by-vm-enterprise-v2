/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Deterministic Stripe idempotency keys for billing mutations (#2228).
 *
 * The upgrade route used to call `updateSubscription()` with no
 * `Idempotency-Key` header: a double-click, a flaky network retry, or a
 * client that retried after the LOCAL db.transaction failed (Stripe already
 * re-priced, DB rolled back — the drift the issue describes) would re-send a
 * fresh mutation and Stripe would happily apply proration AGAIN.
 *
 * The key must be derived from the *intent*, not from a per-attempt row id:
 * every HTTP retry of the same intent has to reproduce the SAME key so
 * Stripe replays the first response instead of charging twice. A random or
 * row-id-per-attempt key would defeat the whole mechanism (retry inserts a
 * new attempt row → new key → second charge). The attempt row is still
 * written first (event-type `subscription.upgrade_attempted`) — it is the
 * forensic marker that a charge may exist, not the dedupe token.
 *
 * `fromPlanId` is part of the material so a legitimate second upgrade
 * (plan changed in between, or a downgrade-then-re-upgrade that healed the
 * DB) produces a DIFFERENT intent and therefore a different key; only
 * retries of the unchanged (tenant, subscription, from → to, interval)
 * intent replay against the original Stripe response.
 *
 * Stripe keys are capped at 255 chars; a sha256 hex digest is 64.
 */
import { createHash } from 'crypto';

export interface UpgradeIdempotencyIntent {
  tenantId: string;
  stripeSubscriptionId: string;
  /** Plan the subscription is on at the moment of the attempt (may be null). */
  fromPlanId: string | null | undefined;
  toPlanId: string;
  interval: string;
}

function digest(material: string[]): string {
  return createHash('sha256').update(material.join('|')).digest('hex');
}

/** Deterministic key for POST .../subscription/upgrade (re-tries replay). */
export function deriveUpgradeIdempotencyKey(intent: UpgradeIdempotencyIntent): string {
  return digest([
    'subscription-upgrade',
    intent.tenantId,
    intent.stripeSubscriptionId,
    intent.fromPlanId ?? 'none',
    intent.toPlanId,
    intent.interval,
  ]);
}

/**
 * Deterministic key for the other subscription mutations (cancel / resume,
 * #2228 same class). `detail` distinguishes cancel-at-period-end from an
 * immediate cancel so the two never replay against each other.
 */
export function deriveSubscriptionActionIdempotencyKey(
  action: 'cancel' | 'resume',
  tenantId: string,
  stripeSubscriptionId: string,
  detail = '',
): string {
  return digest(['subscription-' + action, tenantId, stripeSubscriptionId, detail]);
}

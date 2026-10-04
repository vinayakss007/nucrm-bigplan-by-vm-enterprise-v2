/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2303 — Single source of truth for mapping a Stripe checkout event to a
 * NuCRM plan id.
 *
 * Before this module the webhook resolved plans with a three-step cascade
 * whose last step was an AMOUNT HEURISTIC (`amount_total <= 2900 -> starter`,
 * `<= 7900 -> pro`, else enterprise) and finally coerced a null plan to
 * `'starter'`. On current Stripe API versions the webhook payload does not
 * expand `line_items` and carries `subscription` as a plain string id, so the
 * heuristic was the *primary* path: any pricing change (INR localization,
 * annual discount, promo code, tax-inclusive totals, currency switch) silently
 * granted the wrong tier — a revenue/entitlement bug.
 *
 * The rule now is FAIL CLOSED:
 *   1. Extract the price id from the payload (expanded subscription item, or
 *      expanded line_items) — the only authoritative plan key.
 *   2. If the payload carries no price id, RETRIEVE the checkout session from
 *      the Stripe API with `expand[]=subscription` (existing `getCheckoutSession`
 *      in `@/lib/stripe`, so it stays mockable and inside the client pattern).
 *   3. Map the price id against the env price catalog (`STRIPE_PRICE_*`).
 *   4. No price id, or a price id not in the catalog => NO plan, NO activation.
 *      The caller must keep the tenant in a non-entitled status and alert
 *      admins. There is deliberately no amount-based fallback, opt-in or
 *      otherwise, and no `|| 'starter'` default.
 */

/** Minimal structural shape of a checkout session as seen in a webhook payload. */
interface PriceBearingItem {
  price?: { id?: string } | null;
}

export interface CheckoutSubscriptionLike {
  id?: string;
  items?: { data?: Array<PriceBearingItem | null> } | null;
}

export interface CheckoutSessionLike {
  id?: string;
  subscription?: string | CheckoutSubscriptionLike | null;
  line_items?: { data?: Array<PriceBearingItem | null> } | null;
}

/** Subscription object shape read from `customer.subscription.*` payloads. */
export interface SubscriptionLike {
  items?: { data?: Array<PriceBearingItem | null> } | null;
}

/**
 * Dependencies are injectable so tests (and any future provider swap) can
 * stub the Stripe API retrieval without module-level mocking.
 */
export interface PlanResolutionDeps {
  /** Defaults to `getCheckoutSession` from `@/lib/stripe`. */
  fetchCheckoutSession?: (sessionId: string) => Promise<unknown>;
}

export type CheckoutPlanResolution =
  | {
      ok: true;
      planId: string;
      priceId: string;
      /** Where the price id came from — useful for alerts/metrics. */
      source: 'session-subscription' | 'session-line-items' | 'fetched-session';
    }
  | {
      ok: false;
      reason: 'no-price-id' | 'unmapped-price-id' | 'session-fetch-failed';
      /** The price id that could not be mapped, when one was found. */
      priceId: string | null;
      /** Error thrown by the Stripe retrieval, when applicable. */
      fetchError?: unknown;
    };

// ── Price catalog (env STRIPE_PRICE_*) ───────────────────────────────────────

const PLAN_PRICE_ENV_KEYS: Record<string, string[]> = {
  starter: ['STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_STARTER_YEARLY'],
  pro: ['STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY'],
  enterprise: ['STRIPE_PRICE_ENTERPRISE_MONTHLY', 'STRIPE_PRICE_ENTERPRISE_YEARLY'],
};

/**
 * Map a Stripe price id to a NuCRM plan id using the env price catalog — the
 * single authoritative mapping. Returns null for ANY id that is not explicitly
 * configured; unknown ids are never coerced to a plan.
 */
export function planFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  for (const [plan, keys] of Object.entries(PLAN_PRICE_ENV_KEYS)) {
    for (const key of keys) {
      const configured = process.env[key];
      if (configured && configured === priceId) return plan;
    }
  }
  return null;
}

// ── Price-id extraction ──────────────────────────────────────────────────────

function firstPriceId(items: { data?: Array<PriceBearingItem | null> } | null | undefined): string | null {
  const priceId = items?.data?.[0]?.price?.id;
  return typeof priceId === 'string' && priceId.length > 0 ? priceId : null;
}

/** Price id carried by an EXPANDED subscription object on a session/updated event. */
export function priceIdFromSubscription(subscription: SubscriptionLike | null | undefined): string | null {
  if (!subscription) return null;
  return firstPriceId(subscription.items);
}

/**
 * Price id present in the webhook payload itself (expanded subscription item,
 * or expanded line_items). Plain string `subscription` ids carry NO price
 * information — that is the realistic current-API shape (#2303).
 */
export function priceIdFromCheckoutPayload(session: CheckoutSessionLike): string | null {
  const subscription = session.subscription;
  if (subscription && typeof subscription === 'object') {
    const fromSub = priceIdFromSubscription(subscription);
    if (fromSub) return fromSub;
  }
  return firstPriceId(session.line_items);
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve the plan for a `checkout.session.completed` event. Fail closed: an
 * absent or unmapped price id yields `{ ok: false }` — never a guessed tier.
 */
export async function resolveCheckoutPlan(
  session: CheckoutSessionLike,
  deps: PlanResolutionDeps = {},
): Promise<CheckoutPlanResolution> {
  const payloadPriceId = priceIdFromCheckoutPayload(session);

  if (payloadPriceId) {
    const planId = planFromPriceId(payloadPriceId);
    if (planId) {
      const sub = session.subscription;
      const source =
        sub && typeof sub === 'object' && priceIdFromSubscription(sub) === payloadPriceId
          ? 'session-subscription'
          : 'session-line-items';
      return { ok: true, planId, priceId: payloadPriceId, source };
    }
    // A price id WAS present and is not in the catalog. Retrieving the session
    // would return the same id, so skip the API call and fail closed.
    return { ok: false, reason: 'unmapped-price-id', priceId: payloadPriceId };
  }

  // Payload carries no price id (e.g. `subscription` is a plain string id and
  // `line_items` is unexpanded — the default on recent Stripe API versions).
  // Ask Stripe rather than guessing from the event shape.
  if (!session.id) {
    return { ok: false, reason: 'no-price-id', priceId: null };
  }

  // Stripe API responses are untyped runtime JSON — the same structural-cast
  // pattern the webhook handlers already use for verified event payloads.
  let fetchedRaw: unknown;
  try {
    const { getCheckoutSession } = await import('@/lib/stripe');
    const fetcher = deps.fetchCheckoutSession ?? ((id: string) => getCheckoutSession(id));
    fetchedRaw = await fetcher(session.id);
  } catch (err) {
    return { ok: false, reason: 'session-fetch-failed', priceId: null, fetchError: err };
  }

  const fetched = (fetchedRaw ?? {}) as CheckoutSessionLike;
  const fetchedPriceId = priceIdFromCheckoutPayload(fetched);
  if (!fetchedPriceId) {
    return { ok: false, reason: 'no-price-id', priceId: null };
  }

  const planId = planFromPriceId(fetchedPriceId);
  if (!planId) {
    return { ok: false, reason: 'unmapped-price-id', priceId: fetchedPriceId };
  }
  return { ok: true, planId, priceId: fetchedPriceId, source: 'fetched-session' };
}

/**
 * Tiny Stripe REST client.
 *
 * The repo deliberately doesn't depend on the `stripe` npm package — the
 * existing webhook hand-rolls signature verification, so we follow the same
 * pattern for outbound calls: a single fetch wrapper that handles auth +
 * x-www-form-urlencoded bodies (which is what Stripe's REST API expects for
 * POST requests).
 *
 * Set `STRIPE_SECRET_KEY` in env. Helpers throw a labelled error when it's
 * missing so the UI can surface a "Stripe is not configured" message.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeNotConfiguredError extends Error {
  constructor() {
    super('Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.');
    this.name = 'StripeNotConfiguredError';
  }
}

export class StripeApiError extends Error {
  status: number;
  raw: unknown;
  constructor(message: string, status: number, raw: unknown) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.raw = raw;
  }
}

/** True when STRIPE_SECRET_KEY is set; UI uses this to hide Stripe-only buttons. */
export function isStripeConfigured(): boolean {
  return !!process.env['STRIPE_SECRET_KEY'];
}

/**
 * Encode a nested params object as Stripe's bracketed form-encoded body.
 *
 *   { metadata: { tenant_id: 't1' }, line_items: [{ price: 'p_1', quantity: 1 }] }
 *
 * becomes
 *
 *   metadata[tenant_id]=t1&line_items[0][price]=p_1&line_items[0][quantity]=1
 */
export function encodeStripeForm(
  params: Record<string, unknown>,
  prefix?: string,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const itemKey = `${fullKey}[${i}]`;
        if (item !== null && typeof item === 'object') {
          parts.push(encodeStripeForm(item as Record<string, unknown>, itemKey));
        } else {
          parts.push(`${encodeURIComponent(itemKey)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(encodeStripeForm(value as Record<string, unknown>, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

/**
 * Call any Stripe REST endpoint. Throws StripeNotConfiguredError when the
 * secret is missing and StripeApiError on a non-2xx response.
 */
export async function stripeFetch<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Record<string, unknown> } = {},
): Promise<T> {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) throw new StripeNotConfiguredError();

  const method = init.method ?? 'POST';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };

  let url = `${STRIPE_API}${path}`;
  let body: string | undefined;

  if (init.params) {
    if (method === 'GET') {
      url += '?' + encodeStripeForm(init.params);
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = encodeStripeForm(init.params);
    }
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }

  if (!res.ok) {
    const message =
      (parsed as { error?: { message?: string } })?.error?.message ??
      `Stripe ${method} ${path} failed with ${res.status}`;
    throw new StripeApiError(message, res.status, parsed);
  }
  return parsed as T;
}

/**
 * Resolve the Stripe Price ID for a given plan slug. We map via env vars so
 * ops can rotate prices without a code deploy:
 *
 *   STRIPE_PRICE_PRO=price_xxx
 *   STRIPE_PRICE_STARTER=price_yyy
 *
 * Returns null when the plan has no price (free / unknown / unconfigured).
 */
export function priceIdForPlan(planId: string): string | null {
  const upper = planId.replace(/[^a-z0-9_]/gi, '').toUpperCase();
  return process.env[`STRIPE_PRICE_${upper}`] ?? null;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  customer?: string | null;
  subscription?: string | null;
}

export interface StripeBillingPortalSession {
  id: string;
  url: string;
}

export interface StripeCustomer {
  id: string;
  email?: string | null;
  metadata?: Record<string, string>;
}

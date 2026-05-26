/**
 * Stripe Integration Helpers
 *
 * Uses raw fetch() calls to the Stripe API (no stripe npm package).
 * Follows the same pattern as app/api/tenant/billing/checkout/route.ts.
 */
import crypto from 'crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Get authorization headers for Stripe API calls.
 */
export function getStripeHeaders(): { Authorization: string; 'Content-Type': string } {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/**
 * Flatten nested object into Stripe-compatible form-encoded parameters.
 */
function flatten(prefix: string, obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          Object.assign(result, flatten(`${key}[${i}]`, item as Record<string, unknown>));
        } else {
          result[`${key}[${i}]`] = String(item);
        }
      });
    } else if (typeof v === 'object') {
      Object.assign(result, flatten(key, v as Record<string, unknown>));
    } else {
      result[key] = String(v);
    }
  }
  return result;
}

export interface CheckoutSessionOptions {
  customerEmail?: string;
  customerId?: string;
  successUrl?: string;
  cancelUrl?: string;
  currency?: string;
  interval?: string;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for a plan subscription.
 */
export async function createCheckoutSession(
  tenantId: string,
  planName: string,
  unitAmountCents: number,
  options: CheckoutSessionOptions = {}
): Promise<CheckoutSessionResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const currency = options.currency ?? process.env['STRIPE_CURRENCY'] ?? 'usd';
  const interval = options.interval ?? process.env['STRIPE_DEFAULT_INTERVAL'] ?? 'month';

  const sessionData: Record<string, unknown> = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        recurring: { interval },
        unit_amount: unitAmountCents,
        product_data: { name: `NuCRM ${planName}` },
      },
      quantity: 1,
    }],
    metadata: { tenant_id: tenantId },
    success_url: options.successUrl ?? `${appUrl}/tenant/settings/billing?upgraded=1`,
    cancel_url: options.cancelUrl ?? `${appUrl}/tenant/settings/billing`,
  };

  if (options.customerId) sessionData['customer'] = options.customerId;
  else if (options.customerEmail) sessionData['customer_email'] = options.customerEmail;

  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: getStripeHeaders(),
    body: new URLSearchParams(flatten('', sessionData)).toString(),
  });

  const session = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const errObj = session['error'] as Record<string, unknown> | undefined;
    const message = errObj?.['message'] ?? 'Stripe checkout session creation failed';
    throw new Error(String(message));
  }

  return { id: String(session['id'] ?? ''), url: String(session['url'] ?? '') };
}

/**
 * Create a Stripe Customer Portal session for managing subscriptions.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl?: string
): Promise<{ url: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const body = new URLSearchParams({
    customer: customerId,
    return_url: returnUrl ?? `${appUrl}/tenant/settings/billing`,
  });

  const res = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
    method: 'POST',
    headers: getStripeHeaders(),
    body: body.toString(),
  });

  const session = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const errObj = session['error'] as Record<string, unknown> | undefined;
    const message = errObj?.['message'] ?? 'Stripe portal session creation failed';
    throw new Error(String(message));
  }

  return { url: String(session['url'] ?? '') };
}

/**
 * Create a Stripe Checkout Session for purchasing a module add-on.
 */
export async function createModuleCheckoutSession(
  tenantId: string,
  moduleId: string,
  moduleName: string,
  priceInCents: number,
  options: CheckoutSessionOptions = {}
): Promise<CheckoutSessionResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const currency = options.currency ?? process.env['STRIPE_CURRENCY'] ?? 'usd';
  const interval = options.interval ?? process.env['STRIPE_DEFAULT_INTERVAL'] ?? 'month';

  const sessionData: Record<string, unknown> = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        recurring: { interval },
        unit_amount: priceInCents,
        product_data: { name: `NuCRM Module: ${moduleName}` },
      },
      quantity: 1,
    }],
    metadata: { tenant_id: tenantId, module_id: moduleId, type: 'module_addon' },
    success_url: options.successUrl ?? `${appUrl}/tenant/settings/modules?installed=${moduleId}`,
    cancel_url: options.cancelUrl ?? `${appUrl}/tenant/settings/modules`,
  };

  if (options.customerId) sessionData['customer'] = options.customerId;
  else if (options.customerEmail) sessionData['customer_email'] = options.customerEmail;

  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: getStripeHeaders(),
    body: new URLSearchParams(flatten('', sessionData)).toString(),
  });

  const session = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const errObj = session['error'] as Record<string, unknown> | undefined;
    const message = errObj?.['message'] ?? 'Stripe module checkout creation failed';
    throw new Error(String(message));
  }

  return { id: String(session['id'] ?? ''), url: String(session['url'] ?? '') };
}

/**
 * Verify a Stripe webhook signature and parse the event.
 */
export function constructWebhookEvent(
  payload: string,
  signature: string,
  secret: string
): { id: string; type: string; data: { object: Record<string, unknown> } } {
  const parts = signature.split(',');
  let timestamp = '';
  let v1Signature = '';

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value ?? '';
    if (key === 'v1') v1Signature = value ?? '';
  }

  if (!timestamp || !v1Signature) {
    throw new Error('Invalid Stripe webhook signature format');
  }

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    throw new Error('Stripe webhook timestamp is too old');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Constant-time comparison (buffers must be same length)
  const sigBuffer = Buffer.from(v1Signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new Error('Stripe webhook signature verification failed');
  }

  const event = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  return event;
}

/**
 * Cancel a Stripe subscription.
 */
export async function cancelSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: getStripeHeaders(),
  });

  const result = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const errObj = result['error'] as Record<string, unknown> | undefined;
    const message = errObj?.['message'] ?? 'Stripe subscription cancellation failed';
    throw new Error(String(message));
  }

  return result;
}

/**
 * Update a Stripe subscription (e.g., change plan).
 */
export async function updateSubscription(
  subscriptionId: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: getStripeHeaders(),
    body: new URLSearchParams(params).toString(),
  });

  const result = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const errObj = result['error'] as Record<string, unknown> | undefined;
    const message = errObj?.['message'] ?? 'Stripe subscription update failed';
    throw new Error(String(message));
  }

  return result;
}

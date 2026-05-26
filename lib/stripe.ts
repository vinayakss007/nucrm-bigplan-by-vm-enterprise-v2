/**
 * Stripe Payment Integration for NuCRM
 *
 * Handles:
 * - Checkout session creation (subscription + one-time)
 * - Webhook signature verification
 * - Subscription lifecycle (create, upgrade, cancel, resume)
 * - Customer portal session
 * - Invoice retrieval
 *
 * Configuration:
 *   STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_...
 *   NEXT_PUBLIC_APP_URL     — Base URL for redirect URLs
 *
 * Note: This is a real implementation using Stripe's REST API directly.
 * No `stripe` npm package needed — reduces bundle size and avoids version lock-in.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function getStripeKey(): string {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

function getWebhookSecret(): string {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  return secret;
}

function getAppUrl(): string {
  return process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
}

// ── Core Stripe API Call ─────────────────────────────────────────────────────

async function stripeRequest<T = any>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, any>
): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${getStripeKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const options: RequestInit = { method, headers };

  if (body && method !== 'GET') {
    options.body = new URLSearchParams(flattenObject(body)).toString();
  }

  const url = endpoint.startsWith('http') ? endpoint : `${STRIPE_API}${endpoint}`;
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || `Stripe API error: ${response.status}`;
    console.error('[Stripe] API Error:', data?.error);
    throw new StripeError(errMsg, data?.error?.code, response.status);
  }

  return data as T;
}

/**
 * Flatten nested objects for URL-encoded form data.
 * { subscription_data: { metadata: { tenant_id: 'abc' } } }
 * → { 'subscription_data[metadata][tenant_id]': 'abc' }
 */
function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') {
          Object.assign(result, flattenObject(item, `${fullKey}[${i}]`));
        } else {
          result[`${fullKey}[${i}]`] = String(item);
        }
      });
    } else if (typeof value === 'object') {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}

// ── Error Class ──────────────────────────────────────────────────────────────

export class StripeError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

// ── Customer Management ──────────────────────────────────────────────────────

export async function createCustomer(params: {
  email: string;
  name?: string;
  tenantId: string;
  metadata?: Record<string, string>;
}): Promise<{ id: string; email: string }> {
  return stripeRequest('/customers', 'POST', {
    email: params.email,
    name: params.name,
    metadata: {
      tenant_id: params.tenantId,
      ...params.metadata,
    },
  });
}

export async function getCustomer(customerId: string): Promise<any> {
  return stripeRequest(`/customers/${customerId}`);
}

export async function updateCustomer(customerId: string, params: {
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}): Promise<any> {
  return stripeRequest(`/customers/${customerId}`, 'POST', params);
}

// ── Checkout Sessions ────────────────────────────────────────────────────────

export interface CheckoutParams {
  tenantId: string;
  customerId?: string;
  customerEmail?: string;
  priceId: string;
  mode: 'subscription' | 'payment';
  successUrl?: string;
  cancelUrl?: string;
  trialDays?: number;
  metadata?: Record<string, string>;
  quantity?: number;
}

export async function createCheckoutSession(params: CheckoutParams): Promise<{ id: string; url: string }> {
  const appUrl = getAppUrl();
  const body: Record<string, any> = {
    mode: params.mode,
    success_url: params.successUrl || `${appUrl}/tenant/settings/billing?session_id={CHECKOUT_SESSION_ID}&success=true`,
    cancel_url: params.cancelUrl || `${appUrl}/tenant/settings/billing?cancelled=true`,
    line_items: [
      {
        price: params.priceId,
        quantity: params.quantity || 1,
      },
    ],
    metadata: {
      tenant_id: params.tenantId,
      ...params.metadata,
    },
  };

  if (params.customerId) {
    body['customer'] = params.customerId;
  } else if (params.customerEmail) {
    body['customer_email'] = params.customerEmail;
  }

  if (params.mode === 'subscription' && params.trialDays) {
    body['subscription_data'] = {
      trial_period_days: params.trialDays,
      metadata: { tenant_id: params.tenantId },
    };
  }

  return stripeRequest('/checkout/sessions', 'POST', body);
}

export async function getCheckoutSession(sessionId: string): Promise<any> {
  return stripeRequest(`/checkout/sessions/${sessionId}?expand[]=subscription&expand[]=customer`);
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscription(subscriptionId: string): Promise<any> {
  return stripeRequest(`/subscriptions/${subscriptionId}`);
}

export async function cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<any> {
  if (atPeriodEnd) {
    return stripeRequest(`/subscriptions/${subscriptionId}`, 'POST', {
      cancel_at_period_end: 'true',
    });
  }
  return stripeRequest(`/subscriptions/${subscriptionId}`, 'DELETE');
}

export async function resumeSubscription(subscriptionId: string): Promise<any> {
  return stripeRequest(`/subscriptions/${subscriptionId}`, 'POST', {
    cancel_at_period_end: 'false',
  });
}

export async function updateSubscription(subscriptionId: string, params: {
  priceId?: string;
  quantity?: number;
  metadata?: Record<string, string>;
}): Promise<any> {
  const body: Record<string, any> = {};

  if (params.priceId) {
    // Get current subscription to find item ID
    const sub = await getSubscription(subscriptionId);
    const itemId = sub.items?.data?.[0]?.id;
    if (itemId) {
      body['items'] = [{ id: itemId, price: params.priceId, quantity: params.quantity || 1 }];
    }
  }

  if (params.metadata) {
    body['metadata'] = params.metadata;
  }

  return stripeRequest(`/subscriptions/${subscriptionId}`, 'POST', body);
}

// ── Customer Portal ──────────────────────────────────────────────────────────

export async function createPortalSession(customerId: string, returnUrl?: string): Promise<{ url: string }> {
  const appUrl = getAppUrl();
  return stripeRequest('/billing_portal/sessions', 'POST', {
    customer: customerId,
    return_url: returnUrl || `${appUrl}/tenant/settings/billing`,
  });
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function listInvoices(customerId: string, limit = 10): Promise<{ data: any[] }> {
  return stripeRequest(`/invoices?customer=${customerId}&limit=${limit}&status=paid`);
}

export async function getUpcomingInvoice(customerId: string): Promise<any> {
  return stripeRequest(`/invoices/upcoming?customer=${customerId}`);
}

// ── Webhook Verification ─────────────────────────────────────────────────────

/**
 * Verify Stripe webhook signature using HMAC-SHA256.
 * This is a pure implementation — no Stripe SDK needed.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string
): Promise<any> {
  const secret = getWebhookSecret();
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const v1Sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));

  if (!timestamp || v1Sigs.length === 0) {
    throw new StripeError('Invalid webhook signature format');
  }

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    throw new StripeError('Webhook timestamp too old');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (!v1Sigs.some(sig => timingSafeEqual(sig, expectedSig))) {
    throw new StripeError('Webhook signature verification failed');
  }

  return JSON.parse(payload);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Plan Price Mapping ───────────────────────────────────────────────────────

/**
 * Map NuCRM plan names to Stripe price IDs.
 * Configure these in your Stripe dashboard, then set via env vars.
 */
export function getPriceId(plan: string, interval: 'month' | 'year' = 'month'): string | null {
  const mapping: Record<string, Record<string, string | undefined>> = {
    starter: {
      month: process.env['STRIPE_PRICE_STARTER_MONTHLY'],
      year: process.env['STRIPE_PRICE_STARTER_YEARLY'],
    },
    pro: {
      month: process.env['STRIPE_PRICE_PRO_MONTHLY'],
      year: process.env['STRIPE_PRICE_PRO_YEARLY'],
    },
    enterprise: {
      month: process.env['STRIPE_PRICE_ENTERPRISE_MONTHLY'],
      year: process.env['STRIPE_PRICE_ENTERPRISE_YEARLY'],
    },
  };

  return mapping[plan]?.[interval] || null;
}

// ── Stripe Config Check ──────────────────────────────────────────────────────

export function isStripeConfigured(): boolean {
  return !!(process.env['STRIPE_SECRET_KEY'] && process.env['STRIPE_WEBHOOK_SECRET']);
}

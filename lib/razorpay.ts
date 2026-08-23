/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Razorpay Payment Integration for NuCRM (Indian Market)
 *
 * Handles:
 * - Order creation for one-time and subscription payments
 * - Payment signature verification (HMAC-SHA256)
 * - Subscription lifecycle (create, cancel)
 * - Customer management
 * - Webhook signature verification
 *
 * Configuration:
 *   RAZORPAY_KEY_ID          - rzp_live_... or rzp_test_...
 *   RAZORPAY_KEY_SECRET      - Your Razorpay key secret
 *   RAZORPAY_WEBHOOK_SECRET  - Webhook secret from Razorpay dashboard
 *
 * Note: This is a direct REST implementation - no razorpay npm package needed.
 */

import { webcrypto } from 'crypto';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

// -- Error Classes ------------------------------------------------------------

export class RazorpayNotConfiguredError extends Error {
  constructor() {
    super('Razorpay is not configured (missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET)');
    this.name = 'RazorpayNotConfiguredError';
  }
}

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'RazorpayApiError';
  }
}

export class RazorpaySignatureError extends Error {
  constructor(message = 'Signature verification failed') {
    super(message);
    this.name = 'RazorpaySignatureError';
  }
}

// -- Types --------------------------------------------------------------------

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method: string;
  description: string | null;
  email: string;
  contact: string;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayCustomer {
  id: string;
  entity: string;
  name: string;
  email: string;
  contact: string;
  notes: Record<string, string>;
}

export interface RazorpaySubscription {
  id: string;
  entity: string;
  plan_id: string;
  customer_id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  notes: Record<string, string>;
}

// -- Configuration Check ------------------------------------------------------

/**
 * Check if Razorpay credentials are configured.
 */
export function isRazorpayConfigured(): boolean {
  return !!(process.env['RAZORPAY_KEY_ID'] && process.env['RAZORPAY_KEY_SECRET']);
}

// -- Internal Helpers ---------------------------------------------------------

function getKeyId(): string {
  const key = process.env['RAZORPAY_KEY_ID'];
  if (!key) throw new RazorpayNotConfiguredError();
  return key;
}

function getKeySecret(): string {
  const secret = process.env['RAZORPAY_KEY_SECRET'];
  if (!secret) throw new RazorpayNotConfiguredError();
  return secret;
}

function getWebhookSecret(): string {
  const secret = process.env['RAZORPAY_WEBHOOK_SECRET'];
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
  return secret;
}

/**
 * Make an authenticated request to the Razorpay REST API.
 * Uses HTTP Basic auth with key_id:key_secret.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function razorpayRequest<T = any>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: Record<string, any>,
): Promise<T> {
  const keyId = getKeyId();
  const keySecret = getKeySecret();

  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const headers: Record<string, string> = {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json',
  };

  const options: RequestInit = { method, headers };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${RAZORPAY_API}${endpoint}`;
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.description || `Razorpay API error: ${response.status}`;
    const errCode = data?.error?.code;
    console.error('[Razorpay] API Error:', data?.error);
    throw new RazorpayApiError(errMsg, errCode, response.status);
  }

  return data as T;
}

// -- HMAC Helpers -------------------------------------------------------------

/**
 * Compute HMAC-SHA256 hex digest.
 */
async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await webcrypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLen, '\0');
  const bPadded = b.padEnd(maxLen, '\0');

  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= aPadded.charCodeAt(i) ^ bPadded.charCodeAt(i);
  }
  return result === 0 && a.length === b.length;
}

// -- Public API ---------------------------------------------------------------

/**
 * Create a Razorpay order.
 *
 * @param amount - Amount in smallest currency unit (paise for INR)
 * @param currency - Currency code (e.g., "INR")
 * @param receipt - Unique receipt identifier
 * @param notes - Optional key-value notes
 */
export async function createOrder(
  amount: number,
  currency: string,
  receipt: string,
  notes?: Record<string, string>,
): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>('/orders', 'POST', {
    amount,
    currency,
    receipt,
    ...(notes ? { notes } : {}),
  });
}

/**
 * Verify payment signature after checkout.
 * Razorpay sends orderId|paymentId signed with key_secret.
 *
 * @param orderId - The Razorpay order ID
 * @param paymentId - The Razorpay payment ID
 * @param signature - The signature to verify
 * @returns true if valid
 * @throws RazorpaySignatureError if invalid
 */
export async function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const secret = getKeySecret();
  const message = `${orderId}|${paymentId}`;
  const expectedSignature = await hmacSha256(message, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new RazorpaySignatureError('Payment signature verification failed');
  }

  return true;
}

/**
 * Create a Razorpay subscription.
 *
 * @param planId - Razorpay plan ID
 * @param customerId - Razorpay customer ID
 * @param notes - Optional key-value notes
 */
export async function createSubscription(
  planId: string,
  customerId: string,
  notes?: Record<string, string>,
): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>('/subscriptions', 'POST', {
    plan_id: planId,
    customer_id: customerId,
    total_count: 12,
    ...(notes ? { notes } : {}),
  });
}

/**
 * Cancel a Razorpay subscription.
 *
 * @param subscriptionId - The subscription ID to cancel
 */
export async function cancelSubscription(
  subscriptionId: string,
): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>(
    `/subscriptions/${subscriptionId}/cancel`,
    'POST',
  );
}

/**
 * Fetch payment details by ID.
 *
 * @param paymentId - The Razorpay payment ID
 */
export async function getPayment(
  paymentId: string,
): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${paymentId}`);
}

/**
 * Create a Razorpay customer.
 *
 * @param name - Customer name
 * @param email - Customer email
 * @param contact - Customer phone/contact
 */
export async function createCustomer(
  name: string,
  email: string,
  contact: string,
): Promise<RazorpayCustomer> {
  return razorpayRequest<RazorpayCustomer>('/customers', 'POST', {
    name,
    email,
    contact,
  });
}

/**
 * Verify Razorpay webhook signature.
 * Razorpay signs the raw request body with HMAC-SHA256 using the webhook secret.
 *
 * @param body - Raw request body string
 * @param signature - X-Razorpay-Signature header value
 * @returns true if valid
 * @throws RazorpaySignatureError if invalid
 */
export async function verifyWebhookSignature(
  body: string,
  signature: string,
): Promise<boolean> {
  const secret = getWebhookSecret();
  const expectedSignature = await hmacSha256(body, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new RazorpaySignatureError('Webhook signature verification failed');
  }

  return true;
}

// -- Plan Pricing (INR) -------------------------------------------------------

export const RAZORPAY_PLAN_PRICING: Record<string, Record<string, number>> = {
  starter: {
    month: 149900,  // 1,499 INR in paise
    year: 1439000,  // 14,390 INR in paise
  },
  growth: {
    month: 299900,  // 2,999 INR in paise
    year: 2879000,  // 28,790 INR in paise
  },
  scale: {
    month: 549900,  // 5,499 INR in paise
    year: 5279000,  // 52,790 INR in paise
  },
};

/**
 * Get plan amount in paise for a given plan and interval.
 */
export function getPlanAmount(plan: string, interval: 'month' | 'year'): number | null {
  return RAZORPAY_PLAN_PRICING[plan]?.[interval] ?? null;
}

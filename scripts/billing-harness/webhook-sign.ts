/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Stripe webhook signing helper for the #1477 billing-lifecycle harness.
 *
 * Produces a `stripe-signature` header value in Stripe's exact scheme so that
 * lib/stripe.ts `verifyWebhookSignature` accepts it. The verifier computes a
 * hex HMAC-SHA256 of `${timestamp}.${payload}` keyed with the webhook secret,
 * parses the header format `t=<ts>,v1=<hex>` and constant-time compares within
 * a 300s tolerance. This signer reproduces that scheme with node:crypto.
 *
 * Dependency-free and pure: no env reads, no side effects.
 */

import { createHmac } from 'crypto';

/**
 * Sign a webhook payload using Stripe's HMAC-SHA256 scheme.
 *
 * @param payload   The raw request body (exactly what the server will read).
 * @param secret    The webhook signing secret (whsec_...). TEST value only.
 * @param timestamp Unix seconds; defaults to now. Provide a fixed value to
 *                  produce deterministic signatures in tests.
 * @returns A header value of the form `t=<timestamp>,v1=<hex signature>`.
 */
export function signStripeWebhook(
  payload: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

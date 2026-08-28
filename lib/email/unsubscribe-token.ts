/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from 'crypto';

/**
 * Shared HMAC-SHA256 unsubscribe token helpers.
 *
 * The sender (List-Unsubscribe header / in-body links) and the verifier
 * (`/api/unsubscribe`) MUST derive the token the same way, or valid links break
 * and forged links slip through. Keeping both sides in this one module is what
 * prevents that drift.
 */

/**
 * Resolve the HMAC secret. Prefers a dedicated UNSUBSCRIBE_SECRET, falling back
 * to NEXTAUTH_SECRET. Throws if neither is set — we never generate or verify a
 * token with an empty/undefined secret.
 */
function getUnsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      'Unsubscribe secret not configured. Set UNSUBSCRIBE_SECRET or NEXTAUTH_SECRET.',
    );
  }
  return secret;
}

/**
 * Generate the unsubscribe token for a contact: HMAC-SHA256(secret, contactId)
 * as a lowercase hex string.
 */
export function generateUnsubscribeToken(contactId: string): string {
  return crypto
    .createHmac('sha256', getUnsubscribeSecret())
    .update(contactId)
    .digest('hex');
}

/**
 * Constant-time verification of an unsubscribe token against a contactId.
 *
 * Returns false for a missing token, a length mismatch (which would make
 * timingSafeEqual throw), or a value that does not match — without leaking which
 * via timing. Returns false rather than throwing when the secret is missing so a
 * misconfiguration fails closed (nobody gets unsubscribed) instead of open.
 */
export function verifyUnsubscribeToken(
  contactId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false;

  let expected: string;
  try {
    expected = generateUnsubscribeToken(contactId);
  } catch {
    // Secret not configured — fail closed.
    return false;
  }

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(token, 'hex');

  // timingSafeEqual throws on unequal lengths; guard so we return a boolean and
  // still avoid an early-exit content comparison.
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Signed OAuth state for calendar sync connect flows (#1175).
 *
 * State format: `<base64url payload>.<base64url hmac-sha256(payload)>`
 * The signature prevents attackers from forging state values that would
 * pass the callback's cookie-comparison check.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function getStateSecret(): string {
  return process.env.SESSION_SECRET || process.env.JWT_SECRET || '';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signOAuthState(payload: string): string {
  const secret = getStateSecret();
  if (!secret) {
    // No secret configured — fall back to unsigned payload rather than
    // breaking the flow entirely; callback will reject it in production.
    return b64url(payload);
  }
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${b64url(payload)}.${sig}`;
}

export function verifyOAuthState(signed: string): boolean {
  const secret = getStateSecret();
  if (!secret || !signed) return false;

  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return false; // unsigned or malformed

  const payloadB64 = signed.slice(0, dot);
  const sigB64 = signed.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    if (!payload) return false;
  } catch {
    return false;
  }

  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

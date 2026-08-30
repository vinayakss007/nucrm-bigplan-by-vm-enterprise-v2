/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * First-party analytics anonymous-id cookie.
 *
 * `nucrm_anon_id` is a random UUID that identifies a browser (not a person)
 * so pre-login and post-login behavior can be stitched together. It carries
 * NO identity or entitlement data — paid/plan is always resolved server-side
 * at ingest time (see lib/analytics/entitlement.ts).
 *
 * Cookie attributes follow the analytics-category convention:
 *   - SameSite=Lax   (first-party, survives top-level navigations)
 *   - Secure         (production only)
 *   - NOT HttpOnly   (client JS reads it to attach to track() calls)
 *   - 13-month TTL   (EU-recommended analytics cap)
 */
import { cookies } from 'next/headers';

export const ANON_COOKIE = 'nucrm_anon_id';

/** 13 months in seconds (EU-recommended maximum for analytics cookies). */
export const ANON_MAX_AGE = 60 * 60 * 24 * 397;

/** True when the value looks like a UUID we issued. Rejects tampered junk. */
export function isValidAnonId(value: string | undefined | null): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function anonCookieSecure(): boolean {
  // Mirror the session-cookie policy: forced Secure in production, overridable
  // via COOKIE_SECURE only outside production (for local http dev).
  return process.env['NODE_ENV'] === 'production'
    ? true
    : process.env['COOKIE_SECURE'] !== 'false';
}

/**
 * Read the anon id from the request cookies, or null if absent/invalid.
 * Server-side (route handlers / server components).
 */
export async function readAnonId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(ANON_COOKIE)?.value;
  return isValidAnonId(value) ? value : null;
}

/**
 * Ensure an anon id exists: returns the existing valid one, or mints and sets
 * a new one. Only usable in a context where setting cookies is allowed
 * (route handlers / server actions), since `cookies()` is read-only in RSC.
 */
export async function ensureAnonId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(ANON_COOKIE)?.value;
  if (isValidAnonId(existing)) return existing;

  const id = crypto.randomUUID();
  jar.set(ANON_COOKIE, id, {
    httpOnly: false,
    secure: anonCookieSecure(),
    sameSite: 'lax',
    maxAge: ANON_MAX_AGE,
    path: '/',
  });
  return id;
}

/**
 * Build a Set-Cookie header string for the anon id. Useful when responding
 * from an edge/route handler that manipulates headers directly instead of the
 * cookies() jar.
 */
export function makeAnonCookieString(id: string): string {
  const parts = [
    `${ANON_COOKIE}=${id}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${ANON_MAX_AGE}`,
  ];
  if (anonCookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

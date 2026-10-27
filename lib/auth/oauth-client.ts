/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * OAuth client credentials (#3328).
 *
 * `oauth_clients` had no writer anywhere in the app, so `POST /api/auth/oauth/token`
 * answered `invalid_client` for every caller on a fresh database — the failure was
 * indistinguishable from a wrong secret. These are the two shapes that writer has to
 * get right, kept pure so the route stays about permissions and RLS:
 *
 *  - the secret is generated here and compared verbatim by `timingSafeEqual` at
 *    `app/api/auth/oauth/token/route.ts:79`, so it is stored as produced: hashing it
 *    would change that comparison, and this column is the credential the client keeps.
 *  - `redirect_uris` is ONE text column holding several registered URIs. The matcher
 *    that reads it back (`isRegisteredRedirectUri`, #3324) splits on `,` and trims, so
 *    `serializeRedirectUris` joins on `,` with no padding and each entry is already
 *    trimmed. A comma inside a URI is not registrable — see `isRegistrableRedirectUri`.
 */

import { randomBytes } from 'crypto';

/** Opaque, url-safe, and unique enough that the `client_id` unique index is a formality. */
export function newOAuthClientId(): string {
  return `oc_${randomBytes(16).toString('hex')}`;
}

/** Compared with `timingSafeEqual` after `Buffer.from`, so hex (never base64) keeps it byte-exact. */
export function newOAuthClientSecret(): string {
  return `ocs_${randomBytes(32).toString('hex')}`;
}

/**
 * Why a URI cannot be registered. Returns null when it can.
 *
 * The rules are RFC 6749 §3.1.2's, minus one: a fragment is never transmitted to the
 * client in the redirect, so a registration containing one could only ever be dead
 * weight; userinfo in a redirect URI has the same problem plus an authority-confusion
 * one. The comma rule is ours — it is the delimiter of the column this is stored in.
 */
export function isRegistrableRedirectUri(value: string): string | null {
  if (!value) return 'empty';
  if (value.includes(',')) return 'contains a comma — the delimiter redirect_uris is stored as';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'is not an absolute URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `has scheme ${url.protocol.slice(0, -1)} — only http and https can receive a redirect`;
  }
  if (url.hash) return 'carries a fragment, which is never sent to the client';
  if (url.username || url.password) return 'carries userinfo';
  return null;
}

export function serializeRedirectUris(uris: string[]): string {
  return uris.map((u) => u.trim()).join(',');
}

/** The read-back of the column, in the same shape the matcher compares. */
export function parseRedirectUris(stored: string): string[] {
  return (stored ?? '').split(',').map((u) => u.trim()).filter(Boolean);
}

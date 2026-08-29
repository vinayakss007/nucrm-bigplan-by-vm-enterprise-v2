/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * WhatsApp (Meta Cloud API) access-token expiry helpers (#1294).
 *
 * Meta access tokens expire — long-lived user tokens last ~60 days and can be
 * revoked at any time; only system-user tokens can be configured to never
 * expire. Historically the worker read `access_token` straight out of the
 * integration config and attempted a send with no expiry awareness, so once a
 * token went stale every send failed with an opaque error.
 *
 * These helpers let call sites:
 *   1. Proactively detect a token that is already (about to be) expired, using
 *      an optional `token_expires_at` / `expires_at` stored in the config, and
 *   2. Reactively classify a Meta API error response as a stale-token failure
 *      (HTTP 401 / OAuthException codes 190, 102, 463).
 *
 * NOTE: there is no automatic token refresh/rotation infrastructure yet — a
 * genuine refresh flow is out of scope. These helpers make the *failure* fast
 * and actionable ("re-connect the WhatsApp integration") instead of silent.
 */

/** Skew buffer: treat a token expiring within this window as already expired. */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** Meta OAuthException error codes that indicate an expired/invalid token. */
const STALE_TOKEN_META_CODES = [190, 102, 463];

export interface WhatsAppTokenConfig {
  token_expires_at?: string | number | Date | null;
  expires_at?: string | number | Date | null;
  [key: string]: unknown;
}

/**
 * Returns the token's expiry as a Date if the config carries a parseable
 * `token_expires_at` or `expires_at`, otherwise null (unknown expiry).
 */
export function getTokenExpiry(config: WhatsAppTokenConfig | null | undefined): Date | null {
  const raw = config?.token_expires_at ?? config?.expires_at;
  if (raw === null || raw === undefined || raw === '') return null;
  const date = new Date(raw as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * True when the config carries a known expiry that has passed (or is within the
 * skew buffer). Returns false when no expiry is stored — callers then fall back
 * to reactive detection via {@link isStaleTokenResponse}.
 */
export function isTokenExpired(
  config: WhatsAppTokenConfig | null | undefined,
  now: number = Date.now()
): boolean {
  const expiry = getTokenExpiry(config);
  if (!expiry) return false;
  return expiry.getTime() <= now + TOKEN_EXPIRY_SKEW_MS;
}

/**
 * Classifies a failed Meta Graph API response as a stale/expired-token error.
 * `metaErrorCode` is the `error.code` field from Meta's JSON error body.
 */
export function isStaleTokenResponse(
  httpStatus: number,
  metaErrorCode?: number | string | null
): boolean {
  if (httpStatus === 401) return true;
  return STALE_TOKEN_META_CODES.includes(Number(metaErrorCode));
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Centralized client-IP extraction (#1249).
 *
 * `x-forwarded-for` / `x-real-ip` are client-spoofable unless the deployment
 * sits behind a trusted proxy. IP-derived values are only honored when
 * TRUST_PROXY=true; otherwise callers get the safe 'unknown' default so
 * attackers cannot rotate fake IPs to bypass rate limits.
 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  if (process.env.TRUST_PROXY !== 'true') {
    return 'unknown';
  }

  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

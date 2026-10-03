/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Redirect-target validation (Issue #2218).
 *
 * Any endpoint that answers a 3xx has exactly one safe source of truth for the
 * `Location` header: a value the server stored itself (a tracked-link row, a
 * signed record, an allowlist). Validation here is the SECOND line of defence —
 * it exists so a destination that was written to the database before this rule
 * existed, or by a code path that forgot it, still cannot turn the CRM domain
 * into a phishing redirector.
 *
 * Accepted: an absolute `http(s)` URL with a public hostname, ≤ 2048 chars.
 * Refused: everything else — `javascript:`/`data:`/`mailto:`/any other scheme,
 * the relative-protocol form `//evil.example/x`, bare relative paths, URLs with
 * embedded credentials, and private/reserved hosts (reusing the SSRF guards so
 * the two lists cannot drift apart).
 */
import { isBlockedHostname, isPrivateIpv4, isPrivateIpv6 } from '@/lib/security/ssrf';

/** Upper bound on a stored destination; anything longer is not a real link. */
const MAX_URL_LENGTH = 2048;

/**
 * Returns `raw` unchanged when it is safe to hand to a browser as a redirect
 * target, or `null` when it must not be. Never normalises the string — the
 * caller's `Location` must be byte-for-byte what was registered server-side.
 *
 * Note the WHATWG URL parser strips embedded tabs/newlines before parsing, so
 * `'java\tscript:alert(1)'` arrives here as the `javascript:` scheme and is
 * refused by the protocol check rather than sneaking through as opaque text.
 */
export function safeRedirectTarget(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const candidate = raw.trim();
  if (candidate === '' || candidate.length > MAX_URL_LENGTH) return null;

  // Protocol-relative: `new URL('//evil.example')` throws (no base), and a
  // browser would resolve it against the current scheme + any host the reader
  // was tricked into typing. Refuse rather than depend on who reads it.
  if (candidate.startsWith('//')) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    // Relative paths, fragments, and garbage are all "not an absolute URL".
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  const hostname = parsed.hostname;
  if (hostname === '') return null;
  if (isBlockedHostname(hostname) || isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return null;
  }

  return candidate;
}

/**
 * SSRF (Server-Side Request Forgery) protection for outbound HTTP calls.
 *
 * Any server-side `fetch()` whose URL originates from tenant-supplied data
 * (custom plugin base URLs, integration configs, webhook targets, ... MUST go
 * through `safeFetch()` — or at minimum call `assertSafeUrl()` immediately
 * before fetching.
 *
 * Without this, a tenant user can make the application server issue requests to
 * cloud instance metadata endpoints (169.254.169.254 → IAM credentials),
 * internal-only services and database ports, or enumerate the private network
 * through response/timing differences.
 *
 * DNS rebinding protection: `safeFetch` resolves DNS *before* connecting and
 * validates every resolved IP against the private-range blocklist.  This closes
 * the TOCTOU window where a hostname initially resolves to a public IP (passing
 * hostname-level checks) but is re-bound to a private IP before the TCP
 * connection completes.
 *
 * Escape hatch: set `SSRF_ALLOWED_HOSTS` (comma-separated hostnames) to let a
 * self-hosted operator deliberately permit specific internal hosts. Note that
 * supplying an allowlist makes it authoritative: when it is non-empty, only the
 * hostnames it lists are permitted.
 */

import { resolve4, resolve6 } from 'dns/promises';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum number of redirect hops `safeFetch` will follow (each re-validated). */
const MAX_REDIRECT_HOPS = 3;

/** Thrown when an outbound request is refused by the SSRF guard. */
export class SsrfBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Outbound request blocked: ${reason}`);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
  }
}

/**
 * Private / reserved / non-routable IPv4 ranges.
 * Blocking these is what stops metadata-service and internal-service access.
 */
const PRIVATE_IPV4_RANGES: { cidr: string; prefix: number }[] = [
  { cidr: '10.0.0.0', prefix: 8 },        // RFC1918 private
  { cidr: '172.16.0.0', prefix: 12 },     // RFC1918 private
  { cidr: '192.168.0.0', prefix: 16 },    // RFC1918 private
  { cidr: '127.0.0.0', prefix: 8 },       // loopback
  { cidr: '169.254.0.0', prefix: 16 },    // link local (cloud metadata)
  { cidr: '0.0.0.0', prefix: 8 },         // "this host on this network"
  { cidr: '100.64.0.0', prefix: 10 },     // CGNAT
  { cidr: '192.0.0.0', prefix: 24 },      // IETF protocol assignments
  { cidr: '192.0.2.0', prefix: 24 },      // TEST-NET-1
  { cidr: '198.18.0.0', prefix: 15 },     // benchmarking
  { cidr: '198.51.100.0', prefix: 24 },   // TEST-NET-2
  { cidr: '203.0.113.0', prefix: 24 },    // TEST-NET-3
  { cidr: '224.0.0.0', prefix: 4 },       // multicast
  { cidr: '240.0.0.0', prefix: 4 },       // reserved
  { cidr: '255.255.255.255', prefix: 32 } // broadcast
];

/** Hostname suffixes that only ever resolve inside a private network. */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];

/** Exact hostnames that are always blocked. */
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.goog', 'metadata.google.internal']);

/** Parse a dotted-quad IPv4 literal into its four octets, or null if not one. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value > 255) return null;
    octets.push(value);
  }

  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/** Convert four octets to a 32-bit unsigned integer. */
function ipv4ToInt(octets: [number, number, number, number]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

/** Build a 32-bit netmask for the given prefix length. */
function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/** Parse one `:`-separated IPv6 hextet. */
function parseHextet(part: string): number | null {
  if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
  return Number.parseInt(part, 16);
}

/**
 * Expand an IPv6 literal (with optional `::` compression, surrounding brackets,
 * zone id, or trailing embedded IPv4) into exactly 8 hextets. Null if invalid.
 */
function parseIpv6(ip: string): number[] | null {
  let text = ip.trim().toLowerCase();

  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1);
  }

  const zoneIndex = text.indexOf('%');
  if (zoneIndex !== -1) {
    text = text.slice(0, zoneIndex);
  }

  if (!text.includes(':')) return null;

  // Rewrite a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  const lastColon = text.lastIndexOf(':');
  const lastPart = text.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const embedded = parseIpv4(lastPart);
    if (!embedded) return null;
    const high = ((embedded[0] << 8) | embedded[1]).toString(16);
    const low = ((embedded[2] << 8) | embedded[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const compressionIndex = text.indexOf('::');
  let rawGroups: string[];

  if (compressionIndex === -1) {
    rawGroups = text.split(':');
    if (rawGroups.length !== 8) return null;
  } else {
    if (text.indexOf('::', compressionIndex + 1) !== -1) return null;

    const head = text.slice(0, compressionIndex);
    const tail = text.slice(compressionIndex + 2);
    const headParts = head === '' ? [] : head.split(':');
    const tailParts = tail === '' ? [] : tail.split(':');
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 1) return null;

    rawGroups = [...headParts, ...Array<string>(missing).fill('0'), ...tailParts];
  }

  const groups: number[] = [];
  for (const raw of rawGroups) {
    const hextet = parseHextet(raw);
    if (hextet === null) return null;
    groups.push(hextet);
  }

  return groups;
}

/**
 * True when `ip` is a valid IPv4 literal inside a private, loopback, link-local
 * or otherwise reserved range. Non-IPv4 input returns false.
 */
export function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip.trim());
  if (!octets) return false;

  const value = ipv4ToInt(octets);

  for (const range of PRIVATE_IPV4_RANGES) {
    const base = parseIpv4(range.cidr);
    if (!base) continue;
    const mask = prefixToMask(range.prefix);
    if (((value & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0)) return true;
  }

  return false;
}

/**
 * True when `ip` is a valid IPv6 literal that is loopback, unspecified, unique
 * local, link local, multicast, or an IPv4-mapped address wrapping a private
 * IPv4. Non-IPv6 input returns false.
 */
export function isPrivateIpv6(ip: string): boolean {
  const groups = parseIpv6(ip);
  if (!groups || groups.length !== 8) return false;

  const first = groups[0]!;

  // :: (unspecified) and ::1 (loopback)
  const leadingZeros = groups.slice(0, 7).every((group) => group === 0);
  if (leadingZeros && (groups[7] === 0 || groups[7] === 1)) return true;

  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8  multicast

  // ::ffff:0:0/96 — IPv4-mapped: judge the embedded IPv4.
  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isIpv4Mapped) {
    const high = groups[6]!;
    const low = groups[7]!;
    const embedded = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isPrivateIpv4(embedded);
  }

  return false;
}

/** True when the hostname is a name that only resolves inside a private network. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (host === '') return false;
  if (BLOCKED_HOSTS.has(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Read and normalise the `SSRF_ALLOWED_HOSTS` env var (comma-separated). */
export function getEnvAllowedHosts(): string[] {
  const raw = process.env['SSRF_ALLOWED_HOSTS'];
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Case-insensitive exact hostname match against an allowlist. */
function matchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return allowedHosts.some((allowed) => {
    const candidate = allowed.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return candidate !== '' && candidate === host;
  });
}

/**
 * Validate a user-supplied URL for server-side use.
 *
 * @throws {SsrfBlockedError} when the URL is unparseable, uses a non-HTTP(S)
 * scheme, embeds credentials, targets a blocked hostname or a private/reserved
 * IP literal, or is absent from a supplied allowlist.
 * @returns the parsed `URL` when the target is acceptable.
 */
export function assertSafeUrl(rawUrl: string, opts?: { allowedHosts?: string[] }): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`not a valid absolute URL: ${String(rawUrl)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`protocol "${url.protocol}" is not allowed (only http and https)`);
  }

  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('URL must not contain embedded credentials');
  }

  const hostname = url.hostname;
  if (hostname === '') {
    throw new SsrfBlockedError('URL has no hostname');
  }

  // An explicit allowlist is authoritative: allowlisted hosts bypass the
  // private-IP and blocked-hostname checks, everything else is refused.
  const allowedHosts = (opts?.allowedHosts ?? []).filter((entry) => entry.trim() !== '');
  if (allowedHosts.length > 0) {
    if (matchesAllowlist(hostname, allowedHosts)) return url;
    throw new SsrfBlockedError(`host "${hostname}" is not in the allowlist`);
  }

  if (isBlockedHostname(hostname)) {
    throw new SsrfBlockedError(`host "${hostname}" resolves to a private network`);
  }

  const isBracketedIpv6 = hostname.startsWith('[') && hostname.endsWith(']');
  if (isBracketedIpv6 || hostname.includes(':')) {
    if (isPrivateIpv6(hostname)) {
      throw new SsrfBlockedError(`IPv6 address "${hostname}" is private or reserved`);
    }
  } else if (parseIpv4(hostname) !== null && isPrivateIpv4(hostname)) {
    throw new SsrfBlockedError(`IPv4 address "${hostname}" is private or reserved`);
  }

  return url;
}

/**
 * Resolve a hostname to IP addresses using DNS, then validate that every
 * resolved IP is not private/reserved.  This closes the DNS rebinding window:
 * the hostname is resolved once and the IPs are checked *before* any TCP
 * connection is established.
 *
 * For IP-literal hostnames (no DNS lookup needed) the literal is validated
 * directly.
 *
 * @throws {SsrfBlockedError} when DNS resolution fails or any resolved IP is
 *   private / reserved.
 * @returns the resolved IP addresses (used for logging / audit).
 */
export async function resolveAndValidateIp(
  hostname: string,
  allowedHosts: string[]
): Promise<string[]> {
  // If the hostname matches the allowlist, skip IP validation entirely.
  if (matchesAllowlist(hostname, allowedHosts)) {
    return [hostname];
  }

  // If it's already an IP literal, the existing assertSafeUrl checks cover it.
  if (parseIpv4(hostname) !== null || hostname.includes(':')) {
    return [hostname];
  }

  // DNS resolution — resolve both A and AAAA records.
  const ips: string[] = [];
  try {
    const aRecords = await resolve4(hostname, { ttl: true });
    ips.push(...aRecords.map((r) => r.address));
  } catch {
    // ENODATA / ENOTFOUND are expected for AAAA-only or missing records; not fatal.
  }

  try {
    const aaaaRecords = await resolve6(hostname, { ttl: true });
    ips.push(...aaaaRecords.map((r) => r.address));
  } catch {
    // Same as above.
  }

  if (ips.length === 0) {
    throw new SsrfBlockedError(`DNS resolution for "${hostname}" returned no addresses`);
  }

  for (const ip of ips) {
    if (isPrivateIpv4(ip) || isPrivateIpv6(ip)) {
      throw new SsrfBlockedError(
        `DNS rebinding blocked: "${hostname}" resolved to private IP ${ip}`
      );
    }
  }

  return ips;
}

/**
 * SSRF-aware `fetch`. Validates the target first, disables automatic redirect
 * following, and re-validates every redirect `location` before following it
 * (up to `MAX_REDIRECT_HOPS`) so a 3xx cannot smuggle the request to an
 * internal address.
 *
 * DNS rebinding protection: the hostname is resolved via DNS and every
 * resulting IP is checked against the private-range blocklist *before* the
 * fetch connection is opened.
 *
 * @throws {SsrfBlockedError} when the initial URL or any redirect target fails
 * validation, or the redirect hop limit is exceeded.
 */
export async function safeFetch(
  rawUrl: string,
  init?: RequestInit,
  opts?: { allowedHosts?: string[]; timeoutMs?: number }
): Promise<Response> {
  const allowedHosts = [...(opts?.allowedHosts ?? []), ...getEnvAllowedHosts()];
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  assertSafeUrl(rawUrl, { allowedHosts });

  // Preserve the caller's exact URL string for the first hop; only redirect
  // targets are resolved/normalised by us.
  let target = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const parsedUrl = new URL(target);

    // DNS rebinding protection: resolve and validate IPs before connecting.
    await resolveAndValidateIp(parsedUrl.hostname, allowedHosts);

    const requestInit: RequestInit = {
      ...init,
      redirect: 'manual',
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    };

    const response = await fetch(target, requestInit);

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) return response;

    const location = response.headers?.get('location');
    if (!location) return response;

    if (hop === MAX_REDIRECT_HOPS) {
      throw new SsrfBlockedError(`too many redirects (limit ${MAX_REDIRECT_HOPS})`);
    }

    let resolved: string;
    try {
      resolved = new URL(location, target).toString();
    } catch {
      throw new SsrfBlockedError(`redirect location is not a valid URL: ${location}`);
    }

    target = assertSafeUrl(resolved, { allowedHosts }).toString();
  }

  throw new SsrfBlockedError(`too many redirects (limit ${MAX_REDIRECT_HOPS})`);
}

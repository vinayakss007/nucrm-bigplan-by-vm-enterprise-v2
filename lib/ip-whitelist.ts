/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { decodeSettingValue } from '@/lib/api/setting-value';
import { logger } from '@/lib/logger';
import { withTenantContext, type RlsTransaction } from '@/lib/db/rls';

const IP_WHITELIST_KEY = 'ip_whitelist';

/** Only IPv4 is matched: the whitelist vocabulary the settings page accepts is IPv4/CIDR. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export type IpCheckReason =
  | 'matched' | 'not-matched' | 'no-whitelist' | 'no-tenant' | 'unknown-client-ip' | 'lookup-failed';

/**
 * `cacheable` is false only for a row that exists but could not be read. An
 * empty list means "no restriction", so a value we had to give up on must be
 * re-checked at the next sign-in rather than pinned open for a whole TTL.
 */
async function readWhitelistRow(tenantId: string, tx?: RlsTransaction): Promise<{ ips: string[]; cacheable: boolean }> {
  const source = tx ?? db;
  const [setting] = await source
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, IP_WHITELIST_KEY)
    ))
    .limit(1);

  if (!setting?.value) return { ips: [], cacheable: true };

  // `value` is jsonb, so the driver hands back a decoded array already. The old
  // JSON.parse(String(value)) stringified that array through Array.prototype.join
  // ("203.0.113.9"), threw, and the catch returned [] — which `checkIpWhitelist`
  // reads as "no whitelist configured" and so allows every IP. A tenant that had
  // configured a restriction would have been silently unprotected.
  const decoded = decodeSettingValue<readonly string[] | null>(setting.value, null, 'array');
  if (decoded === null) {
    // Fail open, but loudly: an empty whitelist means "no restriction", so a row
    // we cannot read must not look like a deliberate choice to allow everyone.
    logger.warn('[ip-whitelist] Unreadable whitelist row, treating as no restriction', {
      tenantId,
    });
    return { ips: [], cacheable: false };
  }
  return { ips: decoded as string[], cacheable: true };
}

export async function getTenantWhitelist(tenantId: string, tx?: RlsTransaction): Promise<string[]> {
  return (await readWhitelistRow(tenantId, tx)).ips;
}

const WHITELIST_TTL_MS = 30_000;
const MAX_CACHED_TENANTS = 5_000;
const whitelistCache = new Map<string, { ips: string[]; readAt: number }>();

/**
 * Drop one tenant's cached list, or every entry when called without an id.
 * The settings route calls this after a write so the next sign-in re-reads.
 */
export function invalidateIpWhitelistCache(tenantId?: string): void {
  if (tenantId === undefined) whitelistCache.clear();
  else whitelistCache.delete(tenantId);
}

/**
 * #76 — why this read is cached. The gate runs in its own RLS transaction
 * (BEGIN + two `set_config` + SELECT + COMMIT) and every statement in pre-prod
 * costs a flat ~200 ms (PP-028), so it added ~830 ms to *every* sign-in —
 * including for the tenants that have no list at all, which is the common case.
 * Now one read per tenant per TTL.
 *
 * A write through `app/api/tenant/security/ip-whitelist` invalidates the
 * tenant, and that write is served by the same process that will serve the next
 * login, so saving a list takes effect immediately. The TTL only bounds
 * staleness for a row changed out-of-band (psql, a restore), and it is short
 * because both directions of that staleness are real: a list added behind our
 * back would be missed for up to 30 s (too permissive), and one removed would
 * keep denying for up to 30 s (too restrictive).
 *
 * Deliberately not `lib/cache`: that is Redis, and Redis is not ready in
 * pre-prod (PP-030). A gate that cannot reach its cache must neither fall open
 * nor queue behind a circuit breaker, so this is a plain Map — it cannot fail,
 * and invalidation is synchronous.
 *
 * Residual, recorded: a second app replica would not see the first's
 * invalidation. There is one app container today.
 */
async function getCachedWhitelist(tenantId: string, userId: string): Promise<string[]> {
  const hit = whitelistCache.get(tenantId);
  if (hit && Date.now() - hit.readAt < WHITELIST_TTL_MS) return hit.ips;

  const { ips, cacheable } = await withTenantContext(
    tenantId, userId,
    async (tx) => await readWhitelistRow(tenantId, tx)
  );
  if (!cacheable) return ips;

  // Signup is public, so the set of tenants that ever sign in is bounded by
  // nothing but time. Drop the expired ones first; if it is still full, start
  // over rather than grow with the tenant count.
  if (whitelistCache.size >= MAX_CACHED_TENANTS) {
    const now = Date.now();
    for (const [key, entry] of whitelistCache) {
      if (now - entry.readAt >= WHITELIST_TTL_MS) whitelistCache.delete(key);
    }
    if (whitelistCache.size >= MAX_CACHED_TENANTS) whitelistCache.clear();
  }
  whitelistCache.set(tenantId, { ips, readAt: Date.now() });
  return ips;
}

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [subnet, mask] = cidr.split('/');
  const maskBits = parseInt(mask ?? '0', 10);

  // `1 << 32` is 1 in JS (the shift count wraps mod 32), so a /0 entry — which
  // means "any address" — computed an all-ones mask instead and demanded an
  // exact match. Anyone who saved `10.0.0.0/0` would have been locked out.
  if (!(maskBits > 0)) return true;
  const maskLong = maskBits >= 32 ? -1 : -1 << (32 - maskBits);

  const ipLong = ipToLong(ip);
  const subnetLong = ipToLong(subnet ?? '');

  return (ipLong & maskLong) === (subnetLong & maskLong);
}

function isIpAllowed(clientIp: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return true;
  
  for (const entry of whitelist) {
    if (entry.includes('/')) {
      if (isIpInCidr(clientIp, entry)) return true;
    } else if (entry === clientIp) {
      return true;
    }
  }
  
  return false;
}

/**
 * Why the ambiguous cases fail OPEN.
 * --------------------------------
 * `unknown-client-ip` happens whenever getClientIp() cannot name the caller —
 * i.e. TRUST_PROXY is not 'true', so the app refuses to read x-forwarded-for at
 * all. In that deployment the whitelist is unevaluable, and blocking would turn
 * a tenant's own settings page into a lockout caused by our server config.
 * `lookup-failed` means the row could not be read at all. Both log loudly,
 * because a silently-unenforced restriction is exactly the bug this gate exists
 * to fix: the list was written by the tenant and checked by nothing.
 *
 * The read runs in the tenant's own context — `platform_settings` is guarded by
 * tenant_isolation, so a pre-auth connection would see zero rows and conclude
 * "no restriction" for every tenant.
 */
export async function checkLoginIpAllowed(
  tenantId: string,
  userId: string,
  clientIp: string
): Promise<{ allowed: boolean; reason: IpCheckReason }> {
  if (!tenantId) return { allowed: true, reason: 'no-tenant' };

  let whitelist: string[];
  try {
    whitelist = await getCachedWhitelist(tenantId, userId);
  } catch (err) {
    logger.error('[ip-whitelist] whitelist lookup failed, allowing login', {
      tenantId, error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, reason: 'lookup-failed' };
  }

  if (whitelist.length === 0) return { allowed: true, reason: 'no-whitelist' };
  if (!IPV4.test(clientIp)) {
    logger.warn('[ip-whitelist] client IP not usable, whitelist not evaluated', { tenantId, clientIp });
    return { allowed: true, reason: 'unknown-client-ip' };
  }

  return isIpAllowed(clientIp, whitelist)
    ? { allowed: true, reason: 'matched' }
    : { allowed: false, reason: 'not-matched' };
}

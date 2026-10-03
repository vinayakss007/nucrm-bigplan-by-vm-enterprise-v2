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

export async function getTenantWhitelist(tenantId: string, tx?: RlsTransaction): Promise<string[]> {
  const source = tx ?? db;
  const [setting] = await source
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, IP_WHITELIST_KEY)
    ))
    .limit(1);

  if (!setting?.value) return [];

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
    return [];
  }
  return decoded as string[];
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
    whitelist = await withTenantContext(tenantId, userId, async (tx) => await getTenantWhitelist(tenantId, tx));
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

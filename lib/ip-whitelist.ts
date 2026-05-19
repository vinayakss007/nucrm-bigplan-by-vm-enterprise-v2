import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

const IP_WHITELIST_KEY = 'ip_whitelist';

interface ClientInfo {
  ip: string;
  tenantId: string;
}

async function getTenantWhitelist(tenantId: string): Promise<string[]> {
  const [setting] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, IP_WHITELIST_KEY)
    ))
    .limit(1);

  if (!setting?.value) return [];
  
  try {
    return JSON.parse(String(setting.value));
  } catch {
    return [];
  }
}

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [subnet, mask] = cidr.split('/');
  const maskBits = parseInt(mask ?? '0', 10);
  
  const ipLong = ipToLong(ip);
  const subnetLong = ipToLong(subnet ?? '');
  const maskLong = ~((1 << (32 - maskBits)) - 1);
  
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

export async function checkIpWhitelist(
  request: NextRequest,
  tenantId: string
): Promise<NextResponse | null> {
  const whitelist = await getTenantWhitelist(tenantId);
  
  if (whitelist.length === 0) return null;
  
  const clientIp = 
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  
  if (!isIpAllowed(clientIp, whitelist)) {
    return NextResponse.json(
      { error: 'Access denied from your IP address', code: 'ERR_IP_NOT_ALLOWED' },
      { status: 403 }
    );
  }
  
  return null;
}

export async function getIpWhitelistEnabled(tenantId: string): Promise<boolean> {
  const whitelist = await getTenantWhitelist(tenantId);
  return whitelist.length > 0;
}
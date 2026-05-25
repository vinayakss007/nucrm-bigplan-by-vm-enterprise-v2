/**
 * Multi-frontend API gateway
 * Resolves tenant from various sources and handles CORS for multi-tenant requests.
 */

import { NextRequest } from 'next/server';
import { tryApiKeyAuth } from '@/lib/auth/api-key';
import { AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface GatewayConfig {
  allowedOrigins: string[];
  rateLimitPerKey: number;
  authStrategies: ('api_key' | 'jwt' | 'oauth2')[];
}

export interface GatewayResolution {
  tenantId: string;
  authContext: AuthContext | null;
  source: 'api_key' | 'header' | 'domain' | 'subdomain';
}

/**
 * Resolve which tenant a request is targeting.
 * Priority: API key > X-Tenant-ID header > custom domain > subdomain
 */
export async function resolveGatewayTenant(request: NextRequest): Promise<GatewayResolution | null> {
  // 1. Try API key authentication (sets both tenant and auth)
  const apiKeyCtx = await tryApiKeyAuth(request);
  if (apiKeyCtx) {
    return {
      tenantId: apiKeyCtx.tenantId,
      authContext: apiKeyCtx,
      source: 'api_key',
    };
  }

  // 2. Check X-Tenant-ID header
  const tenantIdHeader = request.headers.get('x-tenant-id');
  if (tenantIdHeader) {
    return {
      tenantId: tenantIdHeader,
      authContext: null,
      source: 'header',
    };
  }

  // 3. Try custom domain lookup
  const host = request.headers.get('host') ?? '';
  const hostname = host.split(':')[0] ?? '';

  if (hostname && !hostname.includes('localhost') && !hostname.endsWith('.nucrm.io')) {
    const result = await db.select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.customDomain, hostname))
      .limit(1);

    const tenant = result[0];
    if (tenant) {
      return {
        tenantId: tenant.id,
        authContext: null,
        source: 'domain',
      };
    }
  }

  // 4. Try subdomain extraction (e.g., acme.nucrm.io)
  if (hostname.endsWith('.nucrm.io')) {
    const subdomain = hostname.replace('.nucrm.io', '');
    if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
      const result = await db.select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.subdomain, subdomain))
        .limit(1);

      const tenant = result[0];
      if (tenant) {
        return {
          tenantId: tenant.id,
          authContext: null,
          source: 'subdomain',
        };
      }
    }
  }

  return null;
}

/**
 * Validate CORS origin against tenant's allowed origins.
 * Tenant-specific allowed origins are stored in settings.allowedOrigins.
 */
export async function validateCORS(origin: string | null, tenantId: string): Promise<boolean> {
  if (!origin) return true; // No origin header (same-origin or server-to-server)

  const result = await db.select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const tenant = result[0];
  if (!tenant) return false;

  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  const allowedOrigins = (settings['allowedOrigins'] as string[]) ?? [];

  // If no origins configured, allow all (open API)
  if (allowedOrigins.length === 0) return true;

  // Check for wildcard
  if (allowedOrigins.includes('*')) return true;

  // Check exact match
  if (allowedOrigins.includes(origin)) return true;

  // Check wildcard subdomain (e.g., *.example.com)
  for (const allowed of allowedOrigins) {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // .example.com
      if (origin.endsWith(suffix) || origin === `https://${allowed.slice(2)}` || origin === `http://${allowed.slice(2)}`) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract API version from pathname.
 * e.g., /api/v2/contacts -> 'v2'
 */
export function extractApiVersion(pathname: string): string | null {
  const match = pathname.match(/^\/api\/(v\d+)\//);
  return match?.[1] ?? null;
}

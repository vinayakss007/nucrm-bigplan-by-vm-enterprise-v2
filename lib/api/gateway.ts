/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Multi-frontend API gateway
 * Resolves tenant from various sources and handles CORS for multi-tenant requests.
 */

import { NextRequest } from 'next/server';
import { tryApiKeyAuth } from '@/lib/auth/api-key';
import { AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, tenantMembers, sessions } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';

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

async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const { verifyToken, hashToken } = await import('@/lib/auth/session');

  // Try JWT cookie first
  const sessionCookie = request.cookies.get('nucrm_session')?.value;
  if (sessionCookie) {
    const payload = await verifyToken(sessionCookie);
    if (payload) {
      const tokenHash = await hashToken(sessionCookie);
      const results = await db.select({ userId: sessions.userId })
        .from(sessions)
        .where(and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ))
        .limit(1);
      if (results[0]) return results[0].userId;
    }
  }

  // Try Authorization Bearer token
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);
    if (payload) {
      // Validate against sessions table to ensure token hasn't been revoked
      const tokenHash = await hashToken(token);
      const results = await db.select({ userId: sessions.userId })
        .from(sessions)
        .where(and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ))
        .limit(1);
      if (results[0]) return results[0].userId;
    }
  }

  return null;
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

  // 2. Check X-Tenant-ID header (requires authentication + tenant membership)
  const tenantIdHeader = request.headers.get('x-tenant-id');
  if (tenantIdHeader) {
    // X-Tenant-ID header-based resolution requires that the request also carries
    // authentication (JWT cookie or Authorization Bearer token). Without auth,
    // anyone could access any tenant's data by setting the header.
    const authHeader = request.headers.get('authorization');
    const sessionCookie = request.cookies.get('nucrm_session')?.value;

    if (!authHeader && !sessionCookie) {
      // Reject unauthenticated header-based resolution
      return null;
    }

    // Verify the authenticated user actually belongs to the claimed tenant
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return null;

    const membership = await db.select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, tenantIdHeader),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.status, 'active'),
      ))
      .limit(1);

    if (!membership[0]) return null;

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
      // Domain-based resolution requires authentication + tenant membership
      const userId = await getAuthenticatedUserId(request);
      if (!userId) return null;

      const membership = await db.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, tenant.id),
          eq(tenantMembers.userId, userId),
          eq(tenantMembers.status, 'active'),
        ))
        .limit(1);

      if (!membership[0]) return null;

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
        // Subdomain-based resolution requires authentication + tenant membership
        const userId = await getAuthenticatedUserId(request);
        if (!userId) return null;

        const membership = await db.select({ id: tenantMembers.id })
          .from(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, tenant.id),
            eq(tenantMembers.userId, userId),
            eq(tenantMembers.status, 'active'),
          ))
          .limit(1);

        if (!membership[0]) return null;

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

  // If no origins configured, deny (must be explicitly set)
  if (allowedOrigins.length === 0) return false;

  // Check for wildcard — only allowed in development
  if (allowedOrigins.includes('*') && process.env['NODE_ENV'] !== 'production') return true;

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

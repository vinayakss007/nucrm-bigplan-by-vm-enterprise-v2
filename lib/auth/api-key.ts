/**
 * API Key Authentication Middleware
 * Validates API keys and sets auth context
 */

import { NextRequest } from 'next/server';
import { db } from '@/drizzle/db';
import { apiKeys, apiKeyUsage, users } from '@/drizzle/schema';
import { eq, and, sql, gt, or, desc, asc } from 'drizzle-orm';
import { AuthContext } from '@/lib/auth/middleware';
import { createHash } from 'crypto';

/**
 * Try to authenticate via API key
 * Returns null if not an API key request
 */
export async function tryApiKeyAuth(request: NextRequest): Promise<AuthContext | null> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ak_')) return null;

  const rawKey = auth.slice(7);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const results = await db.select({
    apiKey: apiKeys,
    isSuperAdmin: users.isSuperAdmin
  })
  .from(apiKeys)
  .innerJoin(users, eq(users.id, apiKeys.userId))
  .where(and(
    eq(apiKeys.keyHash, keyHash),
    eq(apiKeys.isActive, true),
    or(
      sql`${apiKeys.expiresAt} IS NULL`,
      gt(apiKeys.expiresAt, new Date())
    )
  ));

  const row = results[0];
  if (!row) return null;

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ?? null;

  // Update last used
  await db.update(apiKeys)
    .set({ 
      lastUsedAt: new Date()
    })
    .where(eq(apiKeys.keyHash, keyHash));

  // Log usage
  try {
    await db.insert(apiKeyUsage)
      .values({
        apiKeyId: row.apiKey.id,
        tenantId: row.apiKey.tenantId,
        endpoint: request.nextUrl.pathname,
        method: request.method,
        ipAddress: clientIp
      });
  } catch (err) {
    console.error('[API Key] Failed to log usage:', err);
  }

  // Map scopes to permissions
  const scopes = (row.apiKey.scopes as string[]) || [];
  const permissions: Record<string, boolean> = {};
  
  for (const scope of scopes) {
    if (scope === 'all' || scope === '*') {
      permissions['all'] = true;
    } else {
      permissions[scope] = true;
    }
  }

  return {
    userId: row.apiKey.userId!,
    tenantId: row.apiKey.tenantId,
    roleSlug: 'api',
    permissions,
    isAdmin: scopes.includes('all') || scopes.includes('*') || scopes.some((s: string) => s.endsWith(':all')),
    isSuperAdmin: row.isSuperAdmin || false,
  };
}

/**
 * Check if context has required scope
 */
export function hasScope(ctx: AuthContext, requiredScope: string): boolean {
  if (ctx.isSuperAdmin) return true;
  if (ctx.permissions['all']) return true;
  
  // Check exact scope
  if (ctx.permissions[requiredScope]) return true;
  
  // Check wildcard (e.g., contacts:all covers contacts:read)
  const [resource] = requiredScope.split(':');
  if (ctx.permissions[`${resource}:all`]) return true;
  
  return false;
}

/**
 * Generate a new API key
 */
export async function generateApiKey(
  tenantId: string,
  userId: string,
  name: string,
  scopes: string[],
  expiresAt?: string | null
): Promise<{ key: string; prefix: string }> {
  const { randomBytes } = await import('crypto');
  
  // Generate key (ak_<type>_<random>)
  const keyType = 'live'; 
  const randomPart = randomBytes(24).toString('hex');
  const fullKey = `ak_${keyType}_${randomPart}`;
  const prefix = `ak_${keyType}_${randomPart.slice(0, 6)}`;
  
  const keyHash = createHash('sha256').update(fullKey).digest('hex');
  
  // Store in database
  await db.insert(apiKeys)
    .values({
      tenantId,
      userId,
      name,
      keyHash,
      prefix,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });
  
  return { key: fullKey, prefix };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: string, tenantId: string): Promise<boolean> {
  const result = await db.update(apiKeys)
    .set({ isActive: false })
    .where(and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.tenantId, tenantId)
    ));
  
  return true; // Drizzle doesn't return rowCount in the same way as pg
}

/**
 * Rotate an API key (revoke old, create new)
 */
export async function rotateApiKey(
  keyId: string,
  tenantId: string,
  userId: string,
  name: string,
  scopes: string[]
): Promise<{ key: string; prefix: string } | null> {
  // Revoke old key
  await revokeApiKey(keyId, tenantId);
  
  // Generate new key
  return await generateApiKey(tenantId, userId, name, scopes);
}

/**
 * Get API key usage stats
 */
export async function getApiKeyUsage(
  keyId: string,
  days: number = 7
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ total: number; byEndpoint: any[]; byStatus: any[] }> {
  const totalResults = await db.select({
    count: sql<number>`count(*)::int`
  })
  .from(apiKeyUsage)
  .where(and(
    eq(apiKeyUsage.apiKeyId, keyId),
    gt(apiKeyUsage.createdAt, sql`now() - interval '${sql.raw(days.toString())} days'`)
  ));

  const byEndpointResults = await db.select({
    endpoint: apiKeyUsage.endpoint,
    count: sql<number>`count(*)::int`
  })
  .from(apiKeyUsage)
  .where(and(
    eq(apiKeyUsage.apiKeyId, keyId),
    gt(apiKeyUsage.createdAt, sql`now() - interval '${sql.raw(days.toString())} days'`)
  ))
  .groupBy(apiKeyUsage.endpoint)
  .orderBy(desc(sql`count`))
  .limit(10);

  const byStatusResults = await db.select({
    statusCode: apiKeyUsage.statusCode,
    count: sql<number>`count(*)::int`
  })
  .from(apiKeyUsage)
  .where(and(
    eq(apiKeyUsage.apiKeyId, keyId),
    gt(apiKeyUsage.createdAt, sql`now() - interval '${sql.raw(days.toString())} days'`)
  ))
  .groupBy(apiKeyUsage.statusCode)
  .orderBy(asc(apiKeyUsage.statusCode));
  
  return {
    total: totalResults[0]?.count || 0,
    byEndpoint: byEndpointResults,
    byStatus: byStatusResults.map(r => ({ status: r.statusCode, count: r.count })),
  };
}

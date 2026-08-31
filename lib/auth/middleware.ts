/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/drizzle/db';
import { tenants, users, sessions, tenantMembers, roles } from '@/drizzle/schema';
import { eq, and, gt, or, sql, desc, asc } from 'drizzle-orm';
import { verifyToken, hashToken } from '@/lib/auth/session';
import { setTenantContext } from '@/lib/db/rls';
import { tryApiKeyAuth } from '@/lib/auth/api-key';
import { requestContext, withRequestId } from '@/lib/tenant/request-context';
import { withPinnedConnection } from '@/lib/db/request-connection';
import { ModuleRegistry } from '@/lib/modules/registry';
import {
  validateCsrfToken,
  getCsrfTokenFromCookie,
  getCsrfTokenFromHeader,
  needsCsrfValidation
} from '@/lib/auth/csrf';

export interface AuthContext {
  userId: string;
  tenantId: string;
  roleSlug: string;
  permissions: Record<string, boolean>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  // #1836: epoch-ms of the role's `updated_at` at the time this context was
  // built. Used to detect in-place permission edits (same roleSlug) so the
  // cached context is invalidated immediately instead of after the TTL.
  roleVersion?: number;
  noWorkspace?: boolean; // FIX CRITICAL-07: Flag for superadmin without workspace
  user?: {
    id: string;
    email: string;
    full_name: string | null;
    is_super_admin: boolean;
  };
  authMethod?: 'jwt' | 'api_key';
}

async function extractToken(request: NextRequest): Promise<string | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  try {
    const store = await cookies();
    const val = store.get('nucrm_session')?.value;
    if (val) return val;
  } catch { /* cookies() not available */ }
  return request.cookies.get('nucrm_session')?.value ?? null;
}

/**
 * Demo mode is ONLY allowed in development when explicitly enabled.
 * In production, demo mode is NEVER allowed unless ALLOW_DEMO_MODE is explicitly set.
 */
function isDemoModeAllowed(): boolean {
  return process.env['NODE_ENV'] !== 'production' && process.env['ALLOW_DEMO_MODE'] === 'true';
}

/**
 * Get demo tenant context for unauthenticated access (development only)
 */
async function getDemoContext(): Promise<AuthContext | null> {
  if (!isDemoModeAllowed()) return null;

  try {
    const demoTenant = await db.query.tenants.findFirst({
      where: or(eq(tenants.slug, 'demo'), eq(tenants.name, 'Demo Workspace'))
    });

    if (demoTenant) {
      const demoUser = await db.query.users.findFirst({
        where: eq(users.email, 'demo@nucrm.local')
      });

      return {
        userId: demoUser?.id || 'demo-user',
        tenantId: demoTenant.id,
        roleSlug: 'admin',
        permissions: { all: true },
        isAdmin: true,
        isSuperAdmin: false,
        user: demoUser ? {
          id: demoUser.id,
          email: demoUser.email,
          full_name: demoUser.fullName,
          is_super_admin: demoUser.isSuperAdmin ?? false,
        } : { id: 'demo-user', email: 'demo@nucrm.local', full_name: 'Demo User', is_super_admin: false },
        authMethod: 'jwt',
      };
    }
  } catch (err) {
    console.error('Failed to get demo context:', err);
  }
  return null;
}

/**
 * Require authentication middleware with caching
 *
 * Performs auth check using lightweight SELECT statements without
 * wrapping in a DB transaction. RLS context is set on the main DB
 * connection and applies to subsequent handler queries within the
 * same request.
 */
/**
 * Decide whether a cached auth context may still be trusted.
 *
 * The cached context carries tenantId, roleSlug, permissions and the admin
 * flags, with a TTL measured in minutes. Re-checking only that the session row
 * still exists — which is all this used to do — meant an authorization change
 * did not take effect until the entry expired: revoking a member's access, or
 * downgrading their role, left them with their previous tenant and permissions
 * across every route for the rest of the TTL, and `setTenantContext` kept
 * setting the RLS GUCs to the old tenant.
 *
 * So the membership itself is re-checked, not just the session. This costs one
 * additional indexed lookup on the cache-hit path; that is the price of
 * revocation taking effect immediately.
 *
 * Residual gap, deliberately not closed here: editing the permissions *on an
 * existing role in place* leaves roleSlug unchanged and is therefore still
 * served from cache until the TTL expires. Closing that needs a version stamp
 * on the role, which is a schema change.
 */
async function isCachedContextStillAuthorized(
  tokenHash: string,
  cached: AuthContext
): Promise<boolean> {
  const sessionExists = await db.select({ count: sql`count(*)` })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())));

  if (!(Number(sessionExists[0]?.count) > 0)) return false;

  // Super admins have no tenant_members row to validate against.
  if (cached.isSuperAdmin) return true;

  const [membership] = await db.select({
    status: tenantMembers.status,
    roleSlug: tenantMembers.roleSlug,
    roleId: tenantMembers.roleId,
  })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.userId, cached.userId),
      eq(tenantMembers.tenantId, cached.tenantId)
    ))
    .limit(1);

  if (!membership || membership.status !== 'active') return false;

  // A role change must invalidate the cached permission set.
  if ((membership.roleSlug ?? '') !== cached.roleSlug) return false;

  // #1836: detect in-place permission edits (same roleSlug but permissions
  // object changed). The role's `updated_at` serves as a cheap version stamp:
  // if it advanced past what was cached, the permission set may have changed.
  //
  // Treat a missing stamp (roleVersion null/undefined) as 0 rather than
  // skipping the check. Contexts cached before this stamp existed (e.g. across
  // a deploy) or by any path that didn't set it would otherwise NEVER be
  // re-validated against the current role and could serve stale permissions
  // for the full cache TTL. With `0`, the first hit after such a context is
  // cached re-validates against the live role.updatedAt (which is > 0),
  // refreshing it once, after which it carries a proper numeric stamp.
  if (membership.roleId) {
    const cachedVersion = cached.roleVersion ?? 0;
    const [role] = await db.select({ updatedAt: roles.updatedAt })
      .from(roles)
      .where(eq(roles.id, membership.roleId))
      .limit(1);
    const currentVersion = role?.updatedAt ? new Date(role.updatedAt).getTime() : 0;
    if (currentVersion > cachedVersion) return false;
  }

  return true;
}

export async function requireAuth(request: NextRequest): Promise<AuthContext | NextResponse> {
  const requestId = request.headers.get('x-request-id') || requestContext.generateId();
  // #1615: pin ONE PoolClient for this scope so setTenantContext() (session GUC)
  // and the subsequent auth/context queries all run on the SAME connection.
  // No-op under PgBouncer. See lib/db/request-connection.ts for the mechanism and
  // the documented scope boundary (the pin covers the auth + setTenantContext
  // path; route-handler data queries that run after requireAuth returns are
  // outside this ALS scope — see request-connection.ts header and DEPLOYMENT.md).
  return withPinnedConnection(() => withRequestId(requestId, async () => {

    // Try API key auth first
    const apiKeyCtx = await tryApiKeyAuth(request);
    if (apiKeyCtx) {
      apiKeyCtx.authMethod = 'api_key';
      await setTenantContext(apiKeyCtx.tenantId, apiKeyCtx.userId);
      requestContext.set(requestId, { ...apiKeyCtx, cachedAt: Date.now() });
      return apiKeyCtx;
    }

    // Fall back to JWT auth
    const token = await extractToken(request);

    // SECURITY: No token = 401. Demo mode is NEVER a fallback for missing auth.
    if (!token) {
      if (isDemoModeAllowed()) {
        const demoCtx = await getDemoContext();
        if (demoCtx) {
          await setTenantContext(demoCtx.tenantId, demoCtx.userId);
          requestContext.set(requestId, { ...demoCtx, cachedAt: Date.now() });
          return demoCtx;
        }
      }
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const tokenHash = await hashToken(token);

    // Use cached context if available
    const cached = await requestContext.getCached(tokenHash);
    if (cached) {
      if (await isCachedContextStillAuthorized(tokenHash, cached as AuthContext)) {
        await setTenantContext((cached as AuthContext).tenantId, (cached as AuthContext).userId);
        requestContext.set(requestId, cached);
        return cached as AuthContext;
      }

      await requestContext.invalidate(tokenHash);
    }

    // Cache miss - fetch from database
    const session = await db.query.sessions.findFirst({
      where: and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()))
    });
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session expired' },
        { status: 401 }
      );
    }

    // First check if user is a super admin
    const [userRecord] = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isSuperAdmin: users.isSuperAdmin,
      lastTenantId: users.lastTenantId,
    })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

    if (!userRecord) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    // Super admin context — bypass tenant membership lookup
    if (userRecord.isSuperAdmin) {
      const ctx: AuthContext = {
        userId: userRecord.id,
        tenantId: userRecord.lastTenantId || '__superadmin_no_tenant__',
        roleSlug: 'superadmin',
        permissions: { all: true },
        isAdmin: true,
        isSuperAdmin: true,
        noWorkspace: !userRecord.lastTenantId,
      };
      await setTenantContext(ctx.tenantId, ctx.userId);
      await requestContext.cache(tokenHash, { ...ctx, cachedAt: Date.now() });
      return ctx;
    }

    // Fetch tenant membership for non-super-admin users
    const results = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isSuperAdmin: users.isSuperAdmin,
      lastTenantId: users.lastTenantId,
      tenantId: tenantMembers.tenantId,
      roleSlug: tenantMembers.roleSlug,
      permissions: sql`COALESCE(${roles.permissions}, '{}'::jsonb)`,
      roleUpdatedAt: roles.updatedAt,
    })
    .from(users)
    .innerJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.status, 'active')))
    .leftJoin(roles, eq(roles.id, tenantMembers.roleId))
    .where(eq(users.id, payload.userId))
    .orderBy(
      desc(sql`(${tenantMembers.tenantId} = ${users.lastTenantId})::int`), 
      asc(tenantMembers.createdAt)
    )
    .limit(1);

    const userWithMember = results[0];

    if (!userWithMember) {
      return NextResponse.json(
        { error: 'No active workspace' },
        { status: 403 }
      );
    }

    // Set RLS tenant context for database-enforced isolation
    await setTenantContext(userWithMember.tenantId, userWithMember.id);

    const perms = (userWithMember.permissions as Record<string, boolean>) ?? {};
    const ctx: AuthContext = {
      userId: userWithMember.id, tenantId: userWithMember.tenantId,
      roleSlug: userWithMember.roleSlug || '', permissions: perms,
      // #1836: stamp the role version so a later in-place permission edit
      // invalidates this cached context immediately.
      roleVersion: userWithMember.roleUpdatedAt ? new Date(userWithMember.roleUpdatedAt).getTime() : 0,
      isAdmin: userWithMember.roleSlug === 'admin' || userWithMember.isSuperAdmin === true,
      isSuperAdmin: userWithMember.isSuperAdmin || false,
      user: {
        id: userWithMember.id,
        email: userWithMember.email,
        full_name: userWithMember.fullName,
        is_super_admin: false,
      },
    };

    await requestContext.cache(tokenHash, { ...ctx, cachedAt: Date.now() });
    requestContext.set(requestId, { ...ctx, cachedAt: Date.now() });

    return ctx;
  }));
}

export function can(ctx: AuthContext, perm: string): boolean {
  if (ctx.isSuperAdmin || ctx.isAdmin) return true;
  return ctx.permissions['all'] === true || ctx.permissions[perm] === true;
}

export function requirePerm(ctx: AuthContext, perm: string): NextResponse | null {
  if (can(ctx, perm)) {
    return null;
  }
  return NextResponse.json({ error: `Permission denied: ${perm} required` }, { status: 403 });
}

export async function requireModule(ctx: AuthContext, moduleId: string): Promise<NextResponse | null> {
  if (ctx.isSuperAdmin) return null;
  const active = await ModuleRegistry.hasModule(ctx.tenantId, moduleId);
  if (!active) {
    return NextResponse.json({ error: `Module not active: ${moduleId}` }, { status: 403 });
  }
  return null;
}

export async function requireFeature(ctx: AuthContext, moduleId: string, featureKey: string): Promise<NextResponse | null> {
  if (ctx.isSuperAdmin) return null;
  
  // First check if parent module is active
  const modRes = await requireModule(ctx, moduleId);
  if (modRes) return modRes;

  // Then check specific feature toggle
  const hasFeature = await ModuleRegistry.hasFeature(ctx.tenantId, moduleId, featureKey);
  if (!hasFeature) {
    return NextResponse.json({ 
      error: `Specific feature '${featureKey}' is not enabled in the ${moduleId} module.`,
      module: moduleId,
      feature: featureKey
    }, { status: 403 });
  }
  return null;
}

/**
 * CSRF Token Validation Middleware
 *
 * Validates CSRF token for state-changing requests (POST, PUT, PATCH, DELETE)
 * Uses Double Submit Cookie pattern
 */
export function requireCsrf(request: NextRequest): NextResponse | null {
  const method = request.method;
  const path = request.nextUrl.pathname;

  const authMethod = request.headers.get('x-auth-method');

  if (!needsCsrfValidation(method, path, authMethod ?? undefined)) {
    return null;
  }

  const cookieHeader = request.headers.get('cookie');
  const cookieToken = getCsrfTokenFromCookie(cookieHeader);
  const headerToken = getCsrfTokenFromHeader(request.headers);

  if (!validateCsrfToken(cookieToken, headerToken)) {
    return NextResponse.json(
      { error: 'CSRF token missing or invalid. Please refresh the page and try again.' },
      { status: 403 }
    );
  }

  return null;
}

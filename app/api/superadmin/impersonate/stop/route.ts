/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, tenantMembers, sessions, impersonationSessions } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { requireCsrf } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { setImpersonationContext, type RlsTransaction as Tx } from '@/lib/db/rls';
import {
  IMPERSONATION_COOKIE_NAME,
  clearImpersonationTokenCookie,
  getCurrentUserForToken,
  setSessionCookie,
} from '@/lib/auth/session';
import { parseImpersonationNotes, parseOriginalMembershipState } from '@/lib/auth/impersonation-reconcile';
import { logError } from '@/lib/errors-server';

/**
 * POST /api/superadmin/impersonate/stop
 *
 * End the impersonation this browser is holding, hand the admin's own session
 * back and undo the membership the start endpoint upgraded.
 *
 * The caller cannot be identified from `nucrm_session`: starting an
 * impersonation replaces it with the target user's token, so requireAuth here
 * would report a tenant member and every stop would 403. Instead the admin's
 * credential — parked in its own httpOnly cookie at start — is verified against
 * `sessions` and must still belong to a super admin.
 *
 * No session id is taken from the client: what gets ended is the admin's own
 * live impersonation, which that credential resolves.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const adminToken = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
    if (!adminToken) {
      return NextResponse.json({ error: 'No impersonation session for this browser' }, { status: 403 });
    }

    const admin = await getCurrentUserForToken(adminToken);
    if (!admin) {
      await clearImpersonationTokenCookie();
      return NextResponse.json({ error: 'Impersonation credential is no longer valid' }, { status: 401 });
    }
    if (!admin.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    // #1835 defense-in-depth, after the caller is identified: middleware does
    // validate CSRF for this path, but this route is the one mutating endpoint
    // that cannot call requireAuth(), so it asserts the double-submit token
    // itself rather than relying on the global layer alone.
    const csrf = requireCsrf(request);
    if (csrf) return csrf;

    // The tenant comes from the admin's own record, never from the request:
    // impersonate/start writes it, and it is the only handle on which tenant's
    // context can open the impersonation row.
    const tenantId = admin.lastTenantId;
    if (!tenantId) {
      await clearImpersonationTokenCookie();
      return NextResponse.json({ ok: true, message: 'Impersonation ended', alreadyEnded: true });
    }

    const outcome = await withImpersonationContext(tenantId, admin.id, async (tx) => {
      const [session] = await tx
        .select({
          id: impersonationSessions.id,
          targetUserId: impersonationSessions.targetUserId,
          notes: impersonationSessions.notes,
        })
        .from(impersonationSessions)
        .where(and(
          eq(impersonationSessions.impersonatorId, admin.id),
          eq(impersonationSessions.tenantId, tenantId),
          isNull(impersonationSessions.endedAt),
        ))
        .orderBy(desc(impersonationSessions.startedAt))
        .limit(1);

      if (!session) return { ended: false as const };

      const notes = parseImpersonationNotes(session.notes);
      const originalMembershipState = parseOriginalMembershipState(session.notes);

      // The impersonated login dies with the record; the admin's parked session
      // stays, because it is about to become their active one again.
      if (notes.tokenHash) {
        await tx.delete(sessions).where(eq(sessions.tokenHash, notes.tokenHash));
      }

      await tx
        .update(impersonationSessions)
        .set({ endedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(impersonationSessions.id, session.id), isNull(impersonationSessions.endedAt)));

      // tenant_members isolates on app.current_tenant with no super-admin escape,
      // so the tenant context above is what lets this revert reach a row at all —
      // without it the statement matched nothing and left the admin as tenant admin.
      let membershipReverted: boolean;
      if (originalMembershipState.existed) {
        const restored = await tx
          .update(tenantMembers)
          .set({
            status: originalMembershipState.status,
            roleSlug: originalMembershipState.roleSlug,
            updatedAt: new Date(),
          })
          .where(and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, admin.id),
          ))
          .returning({ id: tenantMembers.id });
        membershipReverted = restored.length > 0;
      } else {
        const removed = await tx
          .delete(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, admin.id),
          ))
          .returning({ id: tenantMembers.id });
        membershipReverted = removed.length > 0;
      }

      await tx
        .update(users)
        .set({ lastTenantId: null, updatedAt: new Date() })
        .where(eq(users.id, admin.id));

      return {
        ended: true as const,
        sessionId: session.id,
        targetUserId: session.targetUserId,
        membershipReverted,
        originalMembershipState,
      };
    });

    if (!outcome.ended) {
      await clearImpersonationTokenCookie();
      return NextResponse.json({ ok: true, message: 'Impersonation ended', alreadyEnded: true });
    }

    if (!outcome.membershipReverted) {
      void logError({
        error: new Error('Impersonation ended but the tenant membership could not be reverted'),
        context: 'superadmin/impersonate/stop POST',
        level: 'error',
        metadata: { sessionId: outcome.sessionId, adminId: admin.id, tenantId },
      });
    }

    // Hand the browser back its own session before the parked credential is
    // dropped, otherwise the response leaves a super admin logged out.
    await setSessionCookie(adminToken, 1);
    await clearImpersonationTokenCookie();

    await logSuperAdminAction({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'user.impersonation_ended',
      targetType: 'user',
      targetId: outcome.targetUserId,
      tenantId,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: (request.headers.get('user-agent') || '').slice(0, 255) || undefined,
      metadata: { sessionId: outcome.sessionId, originalMembershipState: outcome.originalMembershipState },
    });

    return NextResponse.json({ ok: true, message: 'Impersonation ended', sessionId: outcome.sessionId });
 
 
  } catch (err) {
    await logError({ error: err, context: 'superadmin/impersonate/stop POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

/**
 * One transaction carrying both contexts the teardown needs: the platform
 * context for `sessions`/`users`, and the target tenant's context for
 * `impersonation_sessions`/`tenant_members`.
 */
async function withImpersonationContext<T>(tenantId: string, adminId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setImpersonationContext(tenantId, adminId, tx);
    return fn(tx);
  });
}

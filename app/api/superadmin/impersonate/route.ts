/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, roles, sessions, impersonationSessions } from '@/drizzle/schema';
import { eq, and, asc, desc, isNull } from 'drizzle-orm';
import { createToken, setSessionCookie, setImpersonationTokenCookie, getCurrentUserForToken, hashToken, IMPERSONATION_COOKIE_NAME } from '@/lib/auth/session';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { setTenantContext, withTenantContext } from '@/lib/db/rls';
import { parseImpersonationNotes, parseOriginalMembershipState } from '@/lib/auth/impersonation-reconcile';
import { logError } from '@/lib/errors-server';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const limited = await rateLimitMutating(request, 'impersonate', 'post');
    if (limited) return limited;

    const { userId, tenantId, reason } = await readJsonBody(request);
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    // One impersonation per browser. Switching tenants without stopping first
    // would move `users.last_tenant_id` — the only handle stop has on the open
    // record — and strand an elevated membership that nothing can revert.
    const parked = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
    if (parked) {
      const active = await getCurrentUserForToken(parked);
      if (active?.isSuperAdmin && active.lastTenantId && active.lastTenantId !== tenantId) {
        return NextResponse.json(
          { error: 'End the current impersonation before starting another one' },
          { status: 409 },
        );
      }
    }

    let targetUserId = userId;
 
 
    let targetUser: { id: string; email: string; fullName: string | null };

    if (targetUserId) {
      const [u] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
      
      if (!u) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      targetUser = u;
    } else {
      // Find the admin member of the tenant.
      //
      // tenant_members isolates on app.current_tenant and has no super-admin
      // escape, so this read runs in the target tenant's context. The user row is
      // fetched separately on the console connection, where `users` is visible.
      const [member] = await withTenantContext<{ userId: string }[]>(
        tenantId,
        ctx.userId,
        tx => tx
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, 'active')))
          .orderBy(asc(tenantMembers.roleSlug), asc(tenantMembers.joinedAt))
          .limit(1),
      );

      if (!member) return NextResponse.json({ error: 'No active user found in this tenant' }, { status: 404 });

      const [adminMember] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, member.userId))
        .limit(1);

      if (!adminMember) return NextResponse.json({ error: 'No active user found in this tenant' }, { status: 404 });
      targetUserId = adminMember.id;
      targetUser = adminMember;
    }

    // Save original membership state so we can restore it when impersonation ends.
    // CRITICAL: We must NOT leave permanent admin memberships behind.
    let originalMembershipState: {
      existed: boolean;
      status: string;
      roleSlug: string;
    } = { existed: false, status: 'active', roleSlug: 'member' };

    // Mint the impersonated token up front: its hash is what the auth middleware
    // re-checks against `sessions` on every request, so the session row, the
    // impersonation record and the cookie must all agree on it.
    // public.start_impersonation() cannot be used — it writes is_impersonation /
    // original_user_id columns that no longer exist, with a fixed token_hash that
    // could never match a real token. The record is written directly instead.
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || null;
    const userAgent = (request.headers.get('user-agent') || '').slice(0, 255);
    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const targetToken = await createToken(targetUserId, 1);
    const targetTokenHash = await hashToken(targetToken);
    // The admin's own credential, parked in a second cookie so the session can
    // be handed back when impersonation ends. It is the session this request
    // already authenticated with, not a freshly minted one: a new `sessions` row
    // per impersonation would be a super-admin credential that outlives the
    // browser copy it was given to and can never be revoked from the panel.
    const adminToken = request.cookies.get('nucrm_session')?.value;
    if (!adminToken) {
      return NextResponse.json(
        { error: 'Impersonation needs a cookie session to restore afterwards' },
        { status: 400 },
      );
    }
    const adminTokenHash = await hashToken(adminToken);

    let sessionId: string | undefined;

    await db.transaction(async (tx) => {
      // tenant_members and roles isolate on app.current_tenant with no
      // super-admin escape, so this transaction has to carry the target tenant's
      // context. On the bare console connection the membership INSERT fails the
      // row-level check and the SELECT below finds nothing.
      await setTenantContext(tenantId, ctx.userId, tx);

      // Starting a second impersonation for the same tenant: the open record's
      // upgrade means tenant_members already says `admin`, so reading it now
      // would store elevated state as the "original" and the eventual stop would
      // leave the admin as a permanent tenant admin. Inherit what the open
      // session captured and retire it instead.
      const [prior] = await tx
        .select({ id: impersonationSessions.id, notes: impersonationSessions.notes })
        .from(impersonationSessions)
        .where(and(
          eq(impersonationSessions.impersonatorId, ctx.userId),
          eq(impersonationSessions.tenantId, tenantId),
          isNull(impersonationSessions.endedAt),
        ))
        .orderBy(desc(impersonationSessions.startedAt))
        .limit(1);

      if (prior) {
        originalMembershipState = parseOriginalMembershipState(prior.notes);
        await tx
          .update(impersonationSessions)
          .set({ endedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(impersonationSessions.id, prior.id), isNull(impersonationSessions.endedAt)));
        // Only the impersonated (target) session is retired. The parked admin
        // credential is the caller's own login session, shared by every
        // impersonation — deleting it would log the admin out mid-request.
        const priorNotes = parseImpersonationNotes(prior.notes);
        if (typeof priorNotes.tokenHash === 'string' && priorNotes.tokenHash.length > 0) {
          await tx.delete(sessions).where(eq(sessions.tokenHash, priorNotes.tokenHash));
        }
      } else {
        const [existingMember] = await tx
          .select({ id: tenantMembers.id, status: tenantMembers.status, roleSlug: tenantMembers.roleSlug })
          .from(tenantMembers)
          .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, ctx.userId)))
          .limit(1);

        if (existingMember) {
          originalMembershipState = {
            existed: true,
            status: existingMember.status,
            roleSlug: existingMember.roleSlug,
          };
        }
      }

      const [adminRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, 'admin')))
        .limit(1);

      const upgraded = await tx
        .update(tenantMembers)
        .set({ status: 'active', roleSlug: 'admin', roleId: adminRole?.id ?? null, updatedAt: new Date() })
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, ctx.userId)))
        .returning({ id: tenantMembers.id });

      if (!upgraded.length) {
        await tx
          .insert(tenantMembers)
          .values({
            tenantId,
            userId: ctx.userId,
            roleSlug: 'admin',
            roleId: adminRole?.id || null,
            status: 'active',
            joinedAt: new Date(),
          });
      }

      // Update last tenant
      await tx
        .update(users)
        .set({ lastTenantId: tenantId, updatedAt: new Date() })
        .where(eq(users.id, ctx.userId));

      // The impersonation record and the live sessions are written in this same
      // transaction: a session the stop endpoint cannot find, or a record with no
      // session behind it, both leave an elevated membership on the tenant.
      // impersonation_sessions has no super-admin escape, hence the tenant context
      // set above covers it too; `sessions` is reachable as the platform console.
      const [impRow] = await tx
        .insert(impersonationSessions)
        .values({
          impersonatorId: ctx.userId,
          targetUserId,
          tenantId,
          reason: reason || null,
          startedAt: new Date(),
          notes: JSON.stringify({ originalMembershipState, tokenHash: targetTokenHash, adminTokenHash, clientIp, userAgent }),
        })
        .returning({ id: impersonationSessions.id });
      sessionId = impRow?.id;

      // Only the impersonated identity needs a new session row; the admin's own
      // session is already in `sessions` — it is what authenticated this request.
      await tx.insert(sessions).values({
        userId: targetUserId,
        tokenHash: targetTokenHash,
        expiresAt: sessionExpiry,
        ipAddress: clientIp,
        userAgent,
      });
    });

    if (!sessionId) {
      return NextResponse.json({ error: 'Could not open the impersonation session' }, { status: 500 });
    }

    // Token is delivered ONLY via httpOnly cookie — never in the response body (XSS theft risk).
    const expiresAt = sessionExpiry.toISOString();
    const response = NextResponse.json({
      ok: true,
      sessionId,
      message: `Impersonating ${targetUser.fullName || targetUser.email}`,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        fullName: targetUser.fullName,
      },
      tenantId,
      expiresAt,
    });

    await setImpersonationTokenCookie(adminToken, 1);
    await setSessionCookie(targetToken, 1);

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'user.impersonation_started',
      targetType: 'user',
      targetId: targetUserId,
      targetName: targetUser.fullName || targetUser.email,
      tenantId,
      ipAddress: clientIp ?? undefined,
      userAgent,
      metadata: { reason, sessionId, originalMembershipState },
    });

    return response;
 
 
  } catch (err) { 
    await logError({ error: err, context: 'superadmin/impersonate POST', requestMethod: 'POST' });
    return apiError(err); 
  }
});


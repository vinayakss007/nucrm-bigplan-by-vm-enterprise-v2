/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, roles } from '@/drizzle/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
import { createToken, setSessionCookie } from '@/lib/auth/session';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const { userId, tenantId, reason } = await readJsonBody(request);
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    let targetUserId = userId;
 
 
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetUser: any;

    if (targetUserId) {
      const [u] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
      
      if (!u) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      targetUser = u;
    } else {
      // Find the admin member of the tenant
      const [adminMember] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, 'active')))
        .orderBy(asc(tenantMembers.roleSlug), asc(tenantMembers.joinedAt))
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

    await db.transaction(async (tx) => {
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
        // Only upgrade to admin if not already admin; restore original on stop
        await tx
          .update(tenantMembers)
          .set({ status: 'active', roleSlug: 'admin' })
          .where(eq(tenantMembers.id, existingMember.id));
      } else {
        originalMembershipState = { existed: false, status: 'active', roleSlug: 'member' };
        const [adminRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, 'admin')))
          .limit(1);

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
    });

    // Start impersonation session (creates DB record + audit log)
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || null;
    const userAgent = (request.headers.get('user-agent') || '').slice(0, 255);

    const res = await db.execute(sql`
      SELECT public.start_impersonation(
        ${ctx.userId}, 
        ${targetUserId}, 
        ${tenantId}, 
        ${clientIp}, 
        ${userAgent}, 
        ${reason || null}
      ) as session_id
    `);

    const sessionId = (res.rows[0] as Record<string, unknown>)?.session_id as string | undefined;

    // Persist original membership state in the impersonation session so stop can restore it
    if (sessionId) {
      await db.execute(sql`
        UPDATE impersonation_sessions
        SET notes = ${JSON.stringify({ originalMembershipState })}
        WHERE id = ${sessionId}::uuid
      `);
    }

    // Create session token for impersonated user (1-day expiry to limit blast radius).
    // Token is delivered ONLY via httpOnly cookie — never in the response body (XSS theft risk).
    const token = await createToken(targetUserId, 1);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
    
    await setSessionCookie(token, 1);

    logSuperAdminAction({
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
 
 
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    console.error('[Impersonation] Error:', err);
    return apiError(err); 
  }
});


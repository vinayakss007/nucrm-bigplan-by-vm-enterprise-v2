import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers, roles } from '@/drizzle/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
import { createToken, setSessionCookie } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const { userId, tenantId, reason } = await request.json();
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    let targetUserId = userId;
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

    await db.transaction(async (tx) => {
      // Ensure super admin is a member of the target tenant (add them if not)
      const [existingMember] = await tx
        .select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, ctx.userId)))
        .limit(1);

      if (!existingMember) {
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
      } else {
        await tx
          .update(tenantMembers)
          .set({ status: 'active', roleSlug: 'admin' })
          .where(eq(tenantMembers.id, existingMember.id));
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

    const sessionId = (res.rows[0] as any)?.session_id;

    // Create session token for impersonated user
    const token = await createToken(targetUserId);
    const response = NextResponse.json({
      ok: true,
      sessionId,
      message: `Impersonating ${targetUser.fullName || targetUser.email}`,
      token,
    });
    
    await setSessionCookie(token);
    return response;
  } catch (err: any) { 
    console.error('[Impersonation] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}


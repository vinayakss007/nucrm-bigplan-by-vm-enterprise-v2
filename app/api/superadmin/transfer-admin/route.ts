/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { verifyPassword } from '@/lib/auth/session';
import { deleteUserSessions } from '@/lib/cache/sessions';
import { withApiRoute } from '@/lib/api/with-api-route';

const schema = z.object({
  targetUserId: z.string().min(1),
  current_password: z.string().min(1, 'Password required for verification'),
  confirm_target_email: z.string().email('Must confirm target email'),
});

/**
 * POST /api/superadmin/transfer-admin
 * 
 * Allows the current super admin to transfer ownership to another user.
 * The caller loses super admin status; the target gains it.
 * This is the ONLY way to change super admin ownership besides initial setup.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { targetUserId, current_password, confirm_target_email } = validated.data;
    if (targetUserId === ctx.userId) return NextResponse.json({ error: 'Cannot transfer to yourself' }, { status: 400 });

    // Re-authenticate caller with password
    const [caller] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (!caller?.passwordHash || !await verifyPassword(current_password, caller.passwordHash)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Verify target user exists
    const [target] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!target) return NextResponse.json({ error: 'Target user not found' }, { status: 404 });

    // Verify confirmed email matches target
    if (confirm_target_email.toLowerCase() !== target.email.toLowerCase()) {
      return NextResponse.json({ error: 'Confirmed email does not match target user' }, { status: 400 });
    }

    // Transfer: make target super admin, demote caller
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ isSuperAdmin: true, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));

      await tx
        .update(users)
        .set({ isSuperAdmin: false, updatedAt: new Date() })
        .where(eq(users.id, ctx.userId));
    });

    // Invalidate both users' session caches so the privilege change takes effect immediately
    await deleteUserSessions(targetUserId);
    await deleteUserSessions(ctx.userId);

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'role.updated',
      targetType: 'user',
      targetId: targetUserId,
      targetName: target.fullName || target.email,
      metadata: { transfer: true, demoted_admin: ctx.user?.email || "", promoted_user: target.email },
    });

    return NextResponse.json({
      ok: true,
      message: `Super admin transferred to ${target.fullName || target.email}. You are now a regular user.`,
      target: { id: target.id, email: target.email, fullName: target.fullName },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/transfer-admin POST]', err);
    return apiError(err);
  }
});


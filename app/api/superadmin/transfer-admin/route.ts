import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/superadmin/transfer-admin
 * 
 * Allows the current super admin to transfer ownership to another user.
 * The caller loses super admin status; the target gains it.
 * This is the ONLY way to change super admin ownership besides initial setup.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { targetUserId } = await request.json();
    if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 });
    if (targetUserId === ctx.userId) return NextResponse.json({ error: 'Cannot transfer to yourself' }, { status: 400 });

    // Verify target user exists
    const [target] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!target) return NextResponse.json({ error: 'Target user not found' }, { status: 404 });

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

    return NextResponse.json({
      ok: true,
      message: `Super admin transferred to ${target.fullName || target.email}. You are now a regular user.`,
      target: { id: target.id, email: target.email, fullName: target.fullName },
    });
  } catch (err: any) {
    console.error('[superadmin/transfer-admin POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


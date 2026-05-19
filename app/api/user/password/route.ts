import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, sessions } from '@/drizzle/schema';
import { eq, and, lt } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '@/lib/auth/session';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { current_password, new_password } = await request.json();
    if (!current_password || !new_password) {
      return NextResponse.json({ error: 'Both passwords required' }, { status: 400 });
    }
    
    // Password validation
    if (new_password.length < 12) return NextResponse.json({ error: 'New password must be at least 12 characters' }, { status: 400 });
    if (!/[A-Z]/.test(new_password)) return NextResponse.json({ error: 'Password must contain an uppercase letter' }, { status: 400 });
    if (!/[0-9]/.test(new_password)) return NextResponse.json({ error: 'Password must contain a number' }, { status: 400 });
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(new_password)) return NextResponse.json({ error: 'Password must contain a special character' }, { status: 400 });

    const userRow = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { passwordHash: true }
    });

    if (!userRow?.passwordHash || !await verifyPassword(current_password, userRow.passwordHash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    const newHash = await hashPassword(new_password);
    
    await db.transaction(async (tx) => {
      // 1. Update password
      await tx.update(users)
        .set({ 
          passwordHash: newHash, 
          updatedAt: new Date() 
        })
        .where(eq(users.id, ctx.userId));

      // 2. Invalidate sessions (all sessions created before now)
      await tx.delete(sessions)
        .where(and(
          eq(sessions.userId, ctx.userId),
          lt(sessions.createdAt, new Date())
        ));
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}

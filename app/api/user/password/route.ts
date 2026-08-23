/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, sessions } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '@/lib/auth/session';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { changePasswordSchema } from '@/lib/api/schemas';
import { concurrencyGuardById } from '@/lib/api/concurrency';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(changePasswordSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { current_password, new_password } = validated.data;

    const conflict = await concurrencyGuardById(db, users, ctx.userId, rawBody.expectedUpdatedAt);
    if (conflict) return conflict;

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

      // 2. Invalidate ALL sessions for this user (unconditional — no race condition)
      await tx.delete(sessions)
        .where(eq(sessions.userId, ctx.userId));
    });

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

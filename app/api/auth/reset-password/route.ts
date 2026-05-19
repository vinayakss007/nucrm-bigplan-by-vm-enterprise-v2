import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, passwordResets, sessions } from '@/drizzle/schema';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { hashPassword, createToken, hashToken, setSessionCookie, validatePassword } from '@/lib/auth/session';
import { sendTelegramToUser } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();
    if (!token || !password) return NextResponse.json({ error: 'Token and password required' }, { status: 400 });

    const pwError = validatePassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(and(
        eq(passwordResets.token, token),
        isNull(passwordResets.deletedAt),
        gt(passwordResets.expiresAt, new Date())
      ))
      .limit(1);

    if (!reset) return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });

    const newPasswordHash = await hashPassword(password);
    const sessionToken = await createToken(reset.userId);
    const sessionTokenHash = await hashToken(sessionToken);

    await db.transaction(async (tx) => {
      // Update password
      await tx.update(users)
        .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
        .where(eq(users.id, reset.userId));
      
      // Mark token used (deleted)
      await tx.update(passwordResets)
        .set({ deletedAt: new Date() })
        .where(eq(passwordResets.id, reset.id));
      
      // Invalidate all existing sessions
      await tx.delete(sessions)
        .where(eq(sessions.userId, reset.userId));
      
      // Create new session
      await tx.insert(sessions).values({
        userId: reset.userId,
        tokenHash: sessionTokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    });

    await setSessionCookie(sessionToken);

    // Send Telegram password change alert
    sendTelegramToUser({
      userId: reset.userId,
      title: '🔑 Password Changed',
      message: 'Your account password has been successfully changed. If this wasn\'t you, contact support immediately.',
      icon: '⚠️',
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

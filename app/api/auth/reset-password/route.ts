/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { setTokenIssueContext, setUserContext } from '@/lib/db/rls';
import { db } from '@/drizzle/db';
import { users, passwordResets, sessions } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { hashPassword, createToken, hashToken, setSessionCookie } from '@/lib/auth/session';
import { newPasswordSchema } from '@/lib/api/schemas/auth';
import { sendTelegramToUser } from '@/lib/email/service';
import { logError } from '@/lib/errors-server';
import { checkRateLimit } from '@/lib/rate-limit';

const schema = z.object({
  token: z.string().min(1),
  password: newPasswordSchema,
});

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkRateLimit(request, { action: 'reset-password', max: 5, windowMinutes: 15 });
    if (rateLimited) return rateLimited;

    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { token, password } = validated.data;

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const newPasswordHash = await hashPassword(password);

    // Atomically CLAIM the reset token before doing anything else. Previously
    // this route did a plain SELECT and only marked the token deleted later in
    // the transaction, so two concurrent requests with the same valid token
    // could both pass the SELECT and each reset the password / mint a session
    // (TOCTOU double-use). The conditional UPDATE ... WHERE deleted_at IS NULL
    // RETURNING lets exactly one request win: the row is claimed in a single
    // atomic statement, and a second request gets zero rows back.
    //
    // Pre-auth by construction: the holder of a reset token has proven nothing
    // that RLS recognises, so the claim runs under app.token_issue (the narrow
    // privilege that admits UPDATE/INSERT on password_resets without an
    // authenticated user) and names the credential it is claiming, which is what
    // keeps the 0135 arms to exactly this row. Once the row is claimed we know
    // userId and switch to app.current_user for the users/sessions writes.
    const claimed = await db.transaction(async (tx) => {
      await setTokenIssueContext(tx, { credential: tokenHash });
      const [reset] = await tx
        .update(passwordResets)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(passwordResets.token, tokenHash),
          isNull(passwordResets.deletedAt),
          gt(passwordResets.expiresAt, new Date())
        ))
        .returning({ id: passwordResets.id, userId: passwordResets.userId });

      if (!reset) return null;

      await setUserContext(reset.userId, tx);

      const sessionToken = await createToken(reset.userId);
      const sessionTokenHash = await hashToken(sessionToken);

      // Update password
      await tx.update(users)
        .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
        .where(eq(users.id, reset.userId));

      // Invalidate all existing sessions
      await tx.delete(sessions)
        .where(eq(sessions.userId, reset.userId));

      // Create new session
      await tx.insert(sessions).values({
        userId: reset.userId,
        tokenHash: sessionTokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      return { userId: reset.userId, sessionToken };
    });

    if (!claimed) return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });

    await setSessionCookie(claimed.sessionToken);

    // Send Telegram password change alert
    sendTelegramToUser({
      userId: claimed.userId,
      title: '🔑 Password Changed',
      message: 'Your account password has been successfully changed. If this wasn\'t you, contact support immediately.',
      icon: '⚠️',
    }).catch((err) => logError({ error: err, context: 'auth/reset-password async side-effect' }));

    return NextResponse.json({ ok: true });
 
 
  } catch (err) {
    return apiError(err);
  }
}

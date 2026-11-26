/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { verify2faSchema } from '@/lib/api/schemas/auth';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyTOTP } from '@/lib/auth/totp';
import { withApiRoute } from '@/lib/api/with-api-route';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { check2faLockout, record2faFailure, clear2faFailures } from '@/lib/auth/totp-lockout';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await rateLimitMutating(request, 'twoFactor', 'post');
    if (limited) return limited;
    const locked = await check2faLockout(ctx.userId);
    if (locked) return locked;

    // readJsonBody turns a malformed body into a 400 (not a 500);
    // validateBody then enforces the 6-digit TOTP shape.
    const body = await readJsonBody(request);
    const validation = validateBody(verify2faSchema, body);
    if (validation instanceof NextResponse) return validation;
    const { totp_code } = validation.data;

    // Get user's TOTP secret
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { totpSecret: true }
    });

    if (!userRow?.totpSecret) {
      return NextResponse.json({ error: '2FA not initiated' }, { status: 400 });
    }

    // Verify TOTP code
    const isValid = verifyTOTP(userRow.totpSecret, totp_code);
    if (!isValid) {
      await record2faFailure(ctx.userId);
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
    }
    await clear2faFailures(ctx.userId);

    // Enable 2FA
    await db.update(users)
      .set({ 
        totpEnabled: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
 
 
  } catch (err) {
    return apiError(err);
  }
});

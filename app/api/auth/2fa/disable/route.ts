/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/auth/session';
import { verifyTOTP } from '@/lib/auth/totp';
import { createHash } from 'crypto';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';

const disable2faBodySchema = z.object({
  password: z.string().min(1, 'Password is required'),
  // A current TOTP code (6 digits) or an 8-char backup recovery code is
  // required in addition to the password so a leaked password alone cannot
  // strip 2FA off an account (#1211).
  totpCode: z.string().trim().min(6, 'Authenticator or backup code is required'),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rateLimited = await checkRateLimit(req, { action: '2fa-disable', max: 3, windowMinutes: 15 });
    if (rateLimited) return rateLimited;
    
    const body = await readJsonBody(req);
    const parsed = validateBody(disable2faBodySchema, body);
    if (parsed instanceof NextResponse) return parsed;
    const { password, totpCode } = parsed.data;
    
    const user = await db.query.users.findFirst({
      columns: { passwordHash: true, totpEnabled: true, totpSecret: true, totpBackupCodes: true },
      where: eq(users.id, ctx.userId)
    });

    if (!user?.totpEnabled) return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
    if (!user.passwordHash || !await verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });

    // Verify the second factor: a live TOTP code, or a one-time backup code.
    const submitted = totpCode.trim();
    let secondFactorValid = verifyTOTP(user.totpSecret ?? '', submitted);
    if (!secondFactorValid && user.totpBackupCodes) {
      const hash = createHash('sha256').update(submitted.toUpperCase()).digest('hex');
      const codes: string[] = typeof user.totpBackupCodes === 'string'
        ? JSON.parse(user.totpBackupCodes)
        : (user.totpBackupCodes as string[]);
      secondFactorValid = Array.isArray(codes) && codes.includes(hash);
    }
    if (!secondFactorValid) {
      return NextResponse.json({ error: 'Invalid authenticator or backup code' }, { status: 401 });
    }
    
    await db.update(users)
      .set({ 
        totpEnabled: false, 
        totpSecret: null, 
        totpBackupCodes: null 
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

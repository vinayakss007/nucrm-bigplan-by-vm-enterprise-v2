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
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { verifyTOTP } from '@/lib/auth/totp';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const verify2faBodySchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'Token must be a 6-digit number'),
});

function generateBackupCodes(count = 8): { plain: string[]; hashed: string[] } {
  const plain = Array.from({length: count}, () => randomBytes(4).toString('hex').toUpperCase());
  const hashed = plain.map(c => createHash('sha256').update(c).digest('hex'));
  return { plain, hashed };
}

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rateLimited = await checkRateLimit(req, { action: '2fa-verify', max: 5, windowMinutes: 15 });
    if (rateLimited) return rateLimited;
    
    const body = await readJsonBody(req);
    const parsed = validateBody(verify2faBodySchema, body);
    if (parsed instanceof NextResponse) return parsed;
    const { token } = parsed.data;

    const user = await db.query.users.findFirst({
      columns: { totpSecret: true, totpEnabled: true },
      where: eq(users.id, ctx.userId)
    });

    if (!user?.totpSecret) {
      return NextResponse.json({ error: 'Setup 2FA first via POST /api/auth/2fa/setup' }, { status: 400 });
    }
    if (user.totpEnabled) {
      return NextResponse.json({ error: '2FA already verified/enabled' }, { status: 400 });
    }

    if (!verifyTOTP(user.totpSecret, token)) {
      return NextResponse.json({ error: 'Invalid token. Check your authenticator app time sync.' }, { status: 401 });
    }

    const { plain, hashed } = generateBackupCodes(8);
    
    await db.update(users)
      .set({ 
        totpEnabled: true, 
        totpVerifiedAt: new Date(), 
        totpBackupCodes: hashed 
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ 
      ok: true, 
      backup_codes: plain, 
      note: 'Save these backup codes — each can only be used once.' 
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
});

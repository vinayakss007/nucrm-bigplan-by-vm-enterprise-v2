/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * Regenerate the signed-in user's backup codes. Same generation and hashing as
 * /api/tenant/2fa/setup — the login path in lib/auth/api-handlers.ts compares
 * sha256(uppercase input), so anything else here silently breaks recovery.
 * Codes are shown once and the previous set stops working immediately.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await checkRateLimit(req, { action: '2fa-backup-codes', max: 3, windowMinutes: 60 });
  if (limited) return limited;

  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [user] = await db
      .select({ totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (!user?.totpEnabled) {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled on this account' },
        { status: 400 }
      );
    }

    const backupCodes = Array.from({ length: 10 }, () => randomBytes(9).toString('hex'));
    const hashedCodes = backupCodes.map(code => createHash('sha256').update(code.toUpperCase()).digest('hex'));

    await db.update(users)
      .set({ totpBackupCodes: hashedCodes, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({
      backup_codes: backupCodes,
      note: 'Save these codes now — they are shown once and the previous set no longer works.',
    });
  } catch (err: unknown) { return apiError(err); }
});

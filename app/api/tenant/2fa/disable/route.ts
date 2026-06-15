import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/auth/session';
import { verifyTOTP } from '@/lib/auth/totp';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { password, totp_code } = await request.json();

    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 });
    }

    // Get user's password hash and 2FA status
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { passwordHash: true, totpEnabled: true, totpSecret: true }
    });

    if (!userRow?.passwordHash || !await verifyPassword(password, userRow.passwordHash)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // If 2FA is enabled, require current code
    if (userRow.totpEnabled) {
      if (!totp_code || !/^\d{6}$/.test(totp_code)) {
        return NextResponse.json({ error: 'Current 2FA code required' }, { status: 400 });
      }

      const valid = verifyTOTP(userRow.totpSecret!, totp_code);
      if (!valid) {
        return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 400 });
      }
    }

    // Disable 2FA
    await db.update(users)
      .set({ 
        totpEnabled: false, 
        totpSecret: null, 
        totpBackupCodes: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

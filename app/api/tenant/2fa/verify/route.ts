import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyTOTP } from '@/lib/auth/totp';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { totp_code } = await request.json();

    if (!totp_code || !/^\d{6}$/.test(totp_code)) {
      return NextResponse.json({ error: 'Invalid 6-digit code' }, { status: 400 });
    }

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
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
    }

    // Enable 2FA
    await db.update(users)
      .set({ 
        totpEnabled: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return apiError(err);
  }
}

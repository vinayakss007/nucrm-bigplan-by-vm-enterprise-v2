import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/auth/session';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const disable2faBodySchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const body = await req.json();
    const parsed = validateBody(disable2faBodySchema, body);
    if (parsed instanceof NextResponse) return parsed;
    const { password } = parsed.data;
    
    const user = await db.query.users.findFirst({
      columns: { passwordHash: true, totpEnabled: true },
      where: eq(users.id, ctx.userId)
    });

    if (!user?.totpEnabled) return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
    if (!user.passwordHash || !await verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    
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

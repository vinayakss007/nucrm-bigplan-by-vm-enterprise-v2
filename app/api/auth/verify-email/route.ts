import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { db } from '@/drizzle/db';
import { users, emailVerifications } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { token } = validated.data;
    
    const hash = createHash('sha256').update(token).digest('hex');
    
    const result = await db.select({
      id: emailVerifications.id,
      userId: emailVerifications.userId,
      email: users.email,
    })
    .from(emailVerifications)
    .innerJoin(users, eq(users.id, emailVerifications.userId))
    .where(and(
      eq(emailVerifications.tokenHash, hash),
      isNull(emailVerifications.usedAt),
      gt(emailVerifications.expiresAt, new Date())
    ))
    .limit(1);

    const row = result[0];
    if (!row) return NextResponse.json({ error: 'Invalid or expired verification link' }, { status: 400 });
    
    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, row.userId));
      
      await tx.update(emailVerifications)
        .set({ usedAt: new Date() })
        .where(eq(emailVerifications.id, row.id));
    });

    return NextResponse.json({ ok: true, email: row.email });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

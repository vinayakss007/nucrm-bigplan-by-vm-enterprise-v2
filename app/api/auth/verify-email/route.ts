import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, emailVerifications } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });
    
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
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}

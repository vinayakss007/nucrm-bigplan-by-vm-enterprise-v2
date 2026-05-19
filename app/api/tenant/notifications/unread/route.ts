import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const [result] = await db.select({
      count: sql<number>`count(*)::int`
    })
    .from(notifications)
    .where(and(
      eq(notifications.userId, ctx.userId),
      isNull(notifications.readAt)
    ));

    return NextResponse.json({ count: result?.count ?? 0 });
  } catch (err) { 
    return NextResponse.json({ count: 0 }); 
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'contacts-recent', 300, async () => {
    const items = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        leadStatus: contacts.leadStatus,
        createdAt: contacts.createdAt,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tid), isNull(contacts.deletedAt)))
      .orderBy(desc(contacts.createdAt))
      .limit(5);

    return NextResponse.json({ data: { items } });
  });
}

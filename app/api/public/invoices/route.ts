import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { invoices, contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');
    if (!email) return NextResponse.json({ data: [] });

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
      columns: { id: true, tenantId: true }
    });

    if (!contact) return NextResponse.json({ data: [] });

    const data = await db.select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, contact.tenantId), eq(invoices.contactId, contact.id), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.createdAt))
      .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}

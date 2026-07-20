import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies, contacts } from '@/drizzle/schema';
import { eq, and, asc } from 'drizzle-orm';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const email = request.headers.get('x-portal-email');
    if (!email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
      columns: { id: true, tenantId: true },
    });
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { id } = await params;
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.tenantId, contact.tenantId),
        eq(supportTickets.contactId, contact.id),
      ))
      .limit(1);

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const replies = await db
      .select({
        id: ticketReplies.id,
        body: ticketReplies.body,
        isInternal: ticketReplies.isInternal,
        userId: ticketReplies.userId,
        contactId: ticketReplies.contactId,
        createdAt: ticketReplies.createdAt,
      })
      .from(ticketReplies)
      .where(eq(ticketReplies.ticketId, id))
      .orderBy(asc(ticketReplies.createdAt));

    return NextResponse.json({ data: { ticket, replies } });
  } catch (err) {
    return apiError(err);
  }
}

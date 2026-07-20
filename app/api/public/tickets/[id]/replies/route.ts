import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies, contacts } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

const replySchema = z.object({
  email: z.string().email(),
  body: z.string().min(1, 'Reply cannot be empty').max(10000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const raw = await request.json();
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { email, body } = parsed.data;
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
      columns: { id: true, tenantId: true },
    });
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { id } = await params;
    const [ticket] = await db
      .select({ id: supportTickets.id, status: supportTickets.status })
      .from(supportTickets)
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.tenantId, contact.tenantId),
        eq(supportTickets.contactId, contact.id),
      ))
      .limit(1);

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    if (ticket.status === 'closed') {
      return NextResponse.json({ error: 'Cannot reply to a closed ticket' }, { status: 409 });
    }

    const [reply] = await db.insert(ticketReplies).values({
      ticketId: id,
      tenantId: contact.tenantId,
      contactId: contact.id,
      body,
      isInternal: false,
    }).returning();

    // Reopen ticket if it was resolved
    if (ticket.status === 'resolved') {
      await db.update(supportTickets)
        .set({ status: 'open', updatedAt: new Date() })
        .where(eq(supportTickets.id, id));
    }

    return NextResponse.json({ data: reply }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}

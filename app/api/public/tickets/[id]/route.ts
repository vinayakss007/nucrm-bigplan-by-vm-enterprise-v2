/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies } from '@/drizzle/schema';
import { eq, and, asc } from 'drizzle-orm';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const token = request.headers.get('x-portal-token');
    if (token) {
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(and(
          eq(supportTickets.id, id),
          eq(supportTickets.portalToken, token),
        ))
        .limit(1);

      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      return ticketWithReplies(id, ticket);
    }

    // Cookie-session path (portal UI): the ticket must belong to the caller's
    // own contact — no cross-contact reads (#1982).
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const contact = await resolvePortalContact(identity);
    if (!contact) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

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
    return ticketWithReplies(id, ticket);
  } catch (err) {
    return apiError(err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ticketWithReplies(id: string, ticket: any) {
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
}

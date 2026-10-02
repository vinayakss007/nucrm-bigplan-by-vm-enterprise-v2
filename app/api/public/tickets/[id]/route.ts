/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies } from '@/drizzle/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
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
      return ticketWithReplies(id, ticket!);
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

// #2217: this endpoint is customer-facing. Staff-internal replies must never
// be listed here (NULL isInternal = public, so `IS NOT TRUE`, not `= false`),
// and the ticket row is projected WITHOUT portal_token — that column is the
// revocable bearer credential for this very route; echoing it to a
// cookie-authed visitor turns a revocable session into a permanent link.
async function ticketWithReplies(id: string, ticket: typeof supportTickets.$inferSelect) {
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
    .where(and(
      eq(ticketReplies.ticketId, id),
      sql`${ticketReplies.isInternal} IS NOT TRUE`,
    ))
    .orderBy(asc(ticketReplies.createdAt));

  const { portalToken: _redacted, ...publicTicket } = ticket;
  return NextResponse.json({ data: { ticket: publicTicket, replies } });
}

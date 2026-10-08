/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies } from '@/drizzle/schema';
import { eq, and, asc, sql, isNull } from 'drizzle-orm';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { PUBLIC_TICKET_COLUMNS, type PublicTicketRow } from '@/lib/public-ticket-projection';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-ticket-detail', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const { id } = await params;

    const token = request.headers.get('x-portal-token');
    if (token) {
      const [ticket] = await db
        .select(PUBLIC_TICKET_COLUMNS)
        .from(supportTickets)
        .where(and(
          eq(supportTickets.id, id),
          eq(supportTickets.portalToken, token),
          isNull(supportTickets.deletedAt),
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
      .select(PUBLIC_TICKET_COLUMNS)
      .from(supportTickets)
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.tenantId, contact.tenantId),
        eq(supportTickets.contactId, contact.id),
        isNull(supportTickets.deletedAt),
      ))
      .limit(1);

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    return ticketWithReplies(id, ticket);
  } catch (err) {
    return apiError(err);
  }
}

// #2443: a customer gets PUBLIC_TICKET_COLUMNS — seven named fields. #2217
// redacted `portal_token` from an unprojected read here and documented that as
// the fix; it was the failure mode. Stripping one field from a whole-row read
// still ships every other field of `support_tickets`, keeps the decision in the
// table definition instead of this file, and lets the next sensitive column a
// migration adds go out without a line of diff. `metadata.resolution` is the
// operator's private note about this customer, and the staff and pipeline uuids
// are the graph behind the ticket; neither is owed to the person the note
// describes.
//
// #2217's replies rule is a filter rather than a projection, and stays:
// staff-internal notes must never be listed (NULL isInternal = public, so
// `IS NOT TRUE`, not `= false`).
async function ticketWithReplies(id: string, ticket: PublicTicketRow) {
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

  // `portal_token` is the revocable bearer credential for this very route —
  // echoing it back turns a revocable session into a permanent link. It is not
  // in the projection, so there is nothing left to strip here.
  return NextResponse.json({ data: { ticket, replies } });
}

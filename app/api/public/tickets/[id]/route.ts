/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { supportTickets, ticketReplies } from '@/drizzle/schema';
import { eq, and, asc, sql, isNull, type SQL } from 'drizzle-orm';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { withTenantContext, withPortalLookupContext, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';
import { PUBLIC_TICKET_COLUMNS, type PublicTicketRow } from '@/lib/public-ticket-projection';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-ticket-detail', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const { id } = await params;

    const token = request.headers.get('x-portal-token');
    if (token) {
      // #2446: the per-ticket token names the ticket, and the ticket names the
      // tenant. Nothing about this route can be read before that — `support_tickets`
      // and `ticket_replies` both carry only `tenant_isolation`, so the article and
      // its replies were silently empty for a valid token on the bare pool. The
      // probe runs in `withPortalLookupContext()` (0122 admits the one row whose
      // `portal_token` matches) and its `tenant_id` — never a request field — is
      // what the reads below are scoped to. It carries the same tombstone filter
      // as the read after it (#2378): a deleted ticket resolves to nothing here,
      // exactly as it did when this was one query.
      const owner = await withPortalLookupContext({ accessToken: token }, async (tx) => {
        const [row] = await tx
          .select({ tenantId: supportTickets.tenantId })
          .from(supportTickets)
          .where(and(
            eq(supportTickets.id, id),
            eq(supportTickets.portalToken, token),
            isNull(supportTickets.deletedAt),
          ))
          .limit(1);
        return row ?? null;
      });

      if (!owner) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

      const page = await withTenantContext(owner.tenantId, NO_USER_SENTINEL, async (tx) => {
        const ticket = await readPublicTicket(tx, id, eq(supportTickets.portalToken, token));

        if (!ticket) return null;
        return { ticket, replies: await readPublicReplies(tx, id) };
      });

      if (!page) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      return NextResponse.json({ data: { ticket: page.ticket, replies: page.replies } });
    }

    // Cookie-session path (portal UI): the ticket must belong to the caller's
    // own contact — no cross-contact reads (#1982).
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // #2446: one transaction for the contact lookup, the ticket and the replies,
    // because that is where `app.current_tenant` lives. A bare `db.*` between them
    // runs on the pool connection and reads as nobody (#2438).
    const page = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return null;

      const ticket = await readPublicTicket(tx, id, and(
        eq(supportTickets.tenantId, contact.tenantId),
        eq(supportTickets.contactId, contact.id),
      ));

      if (!ticket) return null;
      return { ticket, replies: await readPublicReplies(tx, id) };
    });

    if (!page) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    return NextResponse.json({ data: { ticket: page.ticket, replies: page.replies } });
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
//
// It takes `tx` (#2446) — the caller's tenant context is the only reason this
// read returns anything at all.
async function readPublicReplies(tx: RlsTransaction, id: string) {
  return tx
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
}

/**
 * The ticket itself, in the same caller's context (#2446) and the same named
 * projection (#2443); both branches read through it, so what a customer is sent
 * is decided in exactly one place — and so is the tombstone filter, which lives
 * here rather than at the call sites precisely so a new branch cannot forget it
 * (#2382).
 *
 * `PublicTicketRow` is written as the return type rather than inferred, which is
 * what keeps the map and the declared row honest: add, rename or retype a column
 * in `PUBLIC_TICKET_COLUMNS` and this stops compiling, instead of quietly
 * widening what the portal sends.
 */
async function readPublicTicket(
  tx: RlsTransaction,
  id: string,
  ownedBy: SQL | undefined,
): Promise<PublicTicketRow | undefined> {
  const [row] = await tx
    .select(PUBLIC_TICKET_COLUMNS)
    .from(supportTickets)
    .where(and(eq(supportTickets.id, id), ownedBy, isNull(supportTickets.deletedAt)))
    .limit(1);
  return row;
}

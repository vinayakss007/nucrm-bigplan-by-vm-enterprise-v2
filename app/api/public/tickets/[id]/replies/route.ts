/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { supportTickets, ticketReplies } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { withTenantContext, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';

const replySchema = z.object({
  // Per-ticket token for anonymous/embed callers. Logged-in portal callers
  // (session cookie) omit it — ownership is verified from their identity.
  portalToken: z.string().min(16, 'Valid portal token required').optional(),
  body: z.string().min(1, 'Reply cannot be empty').max(10000),
});

/** The ticket row this handler acts on, as the read below projects it. */
interface ReplyTicket {
  id: string;
  status: string | null;
  contactId: string | null;
  tenantId: string;
}

const TICKET_PROJECTION = {
  id: supportTickets.id,
  status: supportTickets.status,
  contactId: supportTickets.contactId,
  tenantId: supportTickets.tenantId,
};

/** The reply row this handler returns, per the `.returning()` list below. */
type ReplyRow = {
  id: string;
  ticketId: string;
  userId: string | null;
  contactId: string | null;
  body: string;
  isInternal: boolean | null;
  createdAt: Date | null;
};

/**
 * What one tenant-scoped transaction decided, mapped to a response by the
 * caller. Keeping `NextResponse` out of the transaction is what stops a 404 or
 * 409 branch from returning while the connection still holds an uncommitted
 * reply (#2446).
 */
type ReplyOutcome =
  | { kind: 'not_found' }
  | { kind: 'closed' }
  | { kind: 'inserted'; reply: ReplyRow | undefined };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-ticket-replies', max: 10, windowMinutes: 1 });
    if (limited) return limited;

    const raw = await readJsonBody(request);
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { portalToken, body } = parsed.data;
    const { id } = await params;

    // Validate token and verify ticket ownership
    if (portalToken) {
      // #2446: the per-ticket token in the body is a credential, not a tenant
      // hint, and `support_tickets` has no policy that can match it — on the bare
      // pool this read returned nothing and every anonymous reply was a 404. It
      // now runs in `withPortalLookupContext()`, whose 0122 arm admits exactly the
      // row whose `portal_token` equals this value; the tenant the write is
      // scoped to comes out of that row. Same tombstone filter as the guard read
      // below it (#2378).
      const owner = await withPortalLookupContext({ accessToken: portalToken }, async (tx) => {
        const [row] = await tx
          .select({ tenantId: supportTickets.tenantId })
          .from(supportTickets)
          .where(and(
            eq(supportTickets.id, id),
            eq(supportTickets.portalToken, portalToken),
            isNull(supportTickets.deletedAt),
          ))
          .limit(1);
        return row ?? null;
      });

      if (!owner) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

      const outcome = await withTenantContext(owner.tenantId, NO_USER_SENTINEL, (tx) =>
        replyWithinContext(tx, id, portalToken, body));

      return replyResponse(outcome);
    }

    // Cookie-session path (portal UI): the ticket must belong to the caller's
    // own contact — no cross-contact writes (#1982).
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // #2446: contact lookup, ticket read, reply insert and the reopen all in one
    // transaction under the tenant the credential names. The insert's own
    // FOR ALL policy compares `tenant_id` to `app.current_tenant`, so without
    // this context a customer could not write a reply at all.
    const outcome = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return { kind: 'not_found' as const };

      const [ticket] = await tx
        .select(TICKET_PROJECTION)
        .from(supportTickets)
        .where(and(
          eq(supportTickets.id, id),
          eq(supportTickets.tenantId, contact.tenantId),
          eq(supportTickets.contactId, contact.id),
          isNull(supportTickets.deletedAt),
        ))
        .limit(1);

      if (!ticket) return { kind: 'not_found' as const };
      return writeReply(tx, ticket, body);
    });

    return replyResponse(outcome);
  } catch (err) {
    return apiError(err);
  }
}

async function replyWithinContext(
  tx: RlsTransaction,
  id: string,
  portalToken: string,
  body: string,
): Promise<ReplyOutcome> {
  const [ticket] = await tx
    .select(TICKET_PROJECTION)
    .from(supportTickets)
    .where(and(
      eq(supportTickets.id, id),
      eq(supportTickets.portalToken, portalToken),
      isNull(supportTickets.deletedAt),
    ))
    .limit(1);

  if (!ticket) return { kind: 'not_found' };
  return writeReply(tx, ticket, body);
}

async function writeReply(
  tx: RlsTransaction,
  ticket: ReplyTicket,
  body: string,
): Promise<ReplyOutcome> {
  if (ticket.status === 'closed') return { kind: 'closed' };

  // #2440: name the columns. This response is appended straight into the
  // customer's thread (app/portal/(protected)/tickets/[id]/page.tsx), so an
  // argument-less `.returning()` would ship every column the table grows —
  // the same class of echo #2217 removed for portal_token. `userId` is kept
  // because the thread renders `!!reply.userId` to tell an agent apart from
  // the visitor; a customer reply always inserts NULL for it.
  const [reply] = await tx.insert(ticketReplies).values({
    ticketId: ticket.id,
    tenantId: ticket.tenantId,
    contactId: ticket.contactId,
    body,
    isInternal: false,
  }).returning({
    id: ticketReplies.id,
    ticketId: ticketReplies.ticketId,
    userId: ticketReplies.userId,
    contactId: ticketReplies.contactId,
    body: ticketReplies.body,
    isInternal: ticketReplies.isInternal,
    createdAt: ticketReplies.createdAt,
  });

  if (ticket.status === 'resolved') {
    await tx.update(supportTickets)
      .set({ status: 'open', updatedAt: new Date() })
      .where(eq(supportTickets.id, ticket.id));
  }

  return { kind: 'inserted', reply };
}

function replyResponse(outcome: ReplyOutcome) {
  if (outcome.kind === 'not_found') return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (outcome.kind === 'closed') {
    return NextResponse.json({ error: 'Cannot reply to a closed ticket' }, { status: 409 });
  }
  return NextResponse.json({ data: outcome.reply }, { status: 201 });
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';

const replySchema = z.object({
  // Per-ticket token for anonymous/embed callers. Logged-in portal callers
  // (session cookie) omit it — ownership is verified from their identity.
  portalToken: z.string().min(16, 'Valid portal token required').optional(),
  body: z.string().min(1, 'Reply cannot be empty').max(10000),
});

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
      const [ticket] = await db
        .select({ id: supportTickets.id, status: supportTickets.status, contactId: supportTickets.contactId, tenantId: supportTickets.tenantId })
        .from(supportTickets)
        .where(and(
          eq(supportTickets.id, id),
          eq(supportTickets.portalToken, portalToken),
        ))
        .limit(1);

      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      return insertReply(id, ticket, body);
    }

    // Cookie-session path (portal UI): the ticket must belong to the caller's
    // own contact — no cross-contact writes (#1982).
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const contact = await resolvePortalContact(identity);
    if (!contact) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const [ticket] = await db
      .select({ id: supportTickets.id, status: supportTickets.status, contactId: supportTickets.contactId, tenantId: supportTickets.tenantId })
      .from(supportTickets)
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.tenantId, contact.tenantId),
        eq(supportTickets.contactId, contact.id),
      ))
      .limit(1);

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    return insertReply(id, ticket, body);
  } catch (err) {
    return apiError(err);
  }
}

async function insertReply(
  id: string,
  ticket: { id: string; status: string | null; contactId: string | null; tenantId: string },
  body: string,
) {
    if (ticket.status === 'closed') {
      return NextResponse.json({ error: 'Cannot reply to a closed ticket' }, { status: 409 });
    }

    const [reply] = await db.transaction(async (tx) => {
      const [r] = await tx.insert(ticketReplies).values({
        ticketId: id,
        tenantId: ticket.tenantId,
        contactId: ticket.contactId,
        body,
        isInternal: false,
      }).returning();

      if (ticket.status === 'resolved') {
        await tx.update(supportTickets)
          .set({ status: 'open', updatedAt: new Date() })
          .where(eq(supportTickets.id, id));
      }

      return [r];
    });

    return NextResponse.json({ data: reply }, { status: 201 });
}

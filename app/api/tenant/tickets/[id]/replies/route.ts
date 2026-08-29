/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ticketReplies, supportTickets, contacts } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { interpolateTemplate } from '@/lib/sms';

export const POST = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const body = await readJsonBody(request);
    if (!body.body?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 });

    // Load the ticket (+ its contact) for SLA tracking AND merge-field
    // interpolation. Reply bodies (including those inserted from a canned
    // response) may contain {{contact.first_name}}, {{ticket.subject}}, etc.;
    // resolve them server-side so the recipient never sees raw placeholders.
    const [ticket] = await db.select({
      firstResponseAt: supportTickets.firstResponseAt,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
    })
      .from(supportTickets)
      .leftJoin(contacts, eq(contacts.id, supportTickets.contactId))
      .where(and(eq(supportTickets.id, id), isNull(supportTickets.deletedAt)))
      .limit(1);

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const contactName = [ticket.contactFirstName, ticket.contactLastName].filter(Boolean).join(' ').trim();
    const mergeVars: Record<string, string> = {
      'contact.first_name': ticket.contactFirstName ?? '',
      'contact.last_name': ticket.contactLastName ?? '',
      'contact.name': contactName,
      'contact.email': ticket.contactEmail ?? '',
      'ticket.subject': ticket.subject ?? '',
      'ticket.status': ticket.status ?? '',
      'ticket.priority': ticket.priority ?? '',
      'agent.name': ctx.user?.full_name ?? '',
      'agent.email': ctx.user?.email ?? '',
    };
    const renderedBody = interpolateTemplate(String(body.body), mergeVars);

    const isFirstResponse = ticket && !ticket.firstResponseAt && !body.is_internal;

    await db.transaction(async (tx) => {
      await tx.insert(ticketReplies).values({
        tenantId: ctx.tenantId,
        ticketId: id,
        userId: ctx.userId,
        body: renderedBody,
        isInternal: body.is_internal || false,
      });

      if (isFirstResponse) {
        await tx.update(supportTickets)
          .set({ firstResponseAt: new Date() })
          .where(eq(supportTickets.id, id));
      }
    });

    return NextResponse.json({ success: true }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ticket reply POST]', err);
    return apiError(err);
  }
});

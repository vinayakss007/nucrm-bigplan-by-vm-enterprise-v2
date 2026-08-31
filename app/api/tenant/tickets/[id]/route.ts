/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateTicketSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import {
  supportTickets,
  ticketReplies,
  contacts,
  users,
  csatSurveys,
  companies,
  deals,
  dealStages,
  invoices,
} from '@/drizzle/schema';
import { eq, and, or, asc, desc } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.view');
    if (permErr) return permErr;

    const [ticket] = await db.select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      body: supportTickets.body,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      created_at: supportTickets.createdAt,
      // FK ids used to build the Customer History panel (#1813)
      contact_id: supportTickets.contactId,
      company_id: supportTickets.companyId,
      deal_id: supportTickets.dealId,
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      contact_email: contacts.email,
      company_name: companies.name,
      assigned_name: users.fullName,
    })
    .from(supportTickets)
    .leftJoin(contacts, eq(contacts.id, supportTickets.contactId))
    .leftJoin(companies, eq(companies.id, supportTickets.companyId))
    .leftJoin(users, eq(users.id, supportTickets.assignedTo))
    .where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)))
    .limit(1);

    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const replies = await db.select({
      id: ticketReplies.id,
      body: ticketReplies.body,
      created_at: ticketReplies.createdAt,
      author_name: users.fullName,
      is_internal: ticketReplies.isInternal,
    })
    .from(ticketReplies)
    .leftJoin(users, eq(users.id, ticketReplies.userId))
    .where(and(eq(ticketReplies.ticketId, id), eq(ticketReplies.tenantId, ctx.tenantId)))
    .orderBy(asc(ticketReplies.createdAt));

    // Customer History (#1813): surface the customer's deals & invoices so a
    // support agent can see sales/billing context without leaving the ticket.
    // Uses the existing contactId/companyId FKs on support_tickets. Each query
    // is wrapped in `safe()` so a failure in one section never breaks the page,
    // and every query is scoped by tenantId to prevent cross-tenant leakage.
    const contactId = ticket.contact_id;
    const companyId = ticket.company_id;

    const safe = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
      try { return await fn(); } catch { return []; }
    };

    // Match records belonging to this customer by contact OR company (whichever
    // the ticket is linked to). If neither is set, skip the queries entirely.
    const hasCustomer = !!(contactId || companyId);

    const relatedDeals = !hasCustomer ? [] : await safe(() =>
      db.select({
        id: deals.id,
        title: deals.title,
        amount: deals.amount,
        stage_name: dealStages.name,
        created_at: deals.createdAt,
      })
      .from(deals)
      .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(
        eq(deals.tenantId, ctx.tenantId),
        or(
          contactId ? eq(deals.contactId, contactId) : undefined,
          companyId ? eq(deals.companyId, companyId) : undefined,
        ),
      ))
      .orderBy(desc(deals.createdAt))
      .limit(10),
    );

    const relatedInvoices = !hasCustomer ? [] : await safe(() =>
      db.select({
        id: invoices.id,
        invoice_number: invoices.invoiceNumber,
        status: invoices.status,
        total_amount: invoices.totalAmount,
        currency: invoices.currency,
        issue_date: invoices.issueDate,
        due_date: invoices.dueDate,
      })
      .from(invoices)
      .where(and(
        eq(invoices.tenantId, ctx.tenantId),
        or(
          contactId ? eq(invoices.contactId, contactId) : undefined,
          companyId ? eq(invoices.companyId, companyId) : undefined,
        ),
      ))
      .orderBy(desc(invoices.issueDate))
      .limit(10),
    );

    const customer = {
      contact_id: contactId,
      contact_name: ticket.first_name ? `${ticket.first_name} ${ticket.last_name || ''}`.trim() : null,
      contact_email: ticket.contact_email,
      company_id: companyId,
      company_name: ticket.company_name,
      deals: relatedDeals,
      invoices: relatedInvoices,
    };

    return NextResponse.json({ data: { ...ticket, replies, customer } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'ticket GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'tickets', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const body = await readJsonBody(request);
    const validated = validateBody(updateTicketSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, supportTickets, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};

    if (v.status) {
      updates['status'] = v.status;
      if (v.status === 'resolved') {
        updates['resolvedAt'] = new Date();
      } else if (v.status !== 'closed') {
        updates['resolvedAt'] = null;
      }
    }
    if (v.priority) updates['priority'] = v.priority;
    if (v.assigned_to) updates['assignedTo'] = v.assigned_to;

    let surveyToken: string | undefined;
    let surveyContactEmail: string | undefined;
    let surveyContactName: string | undefined;
    let ticketSubject: string | undefined;

    await db.transaction(async (tx) => {
      await tx.update(supportTickets)
        .set(updates)
        .where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)));

      if (v.status === 'resolved') {
        const [ticket] = await tx.select({
          contactId: supportTickets.contactId,
          subject: supportTickets.subject,
        })
        .from(supportTickets)
        .where(eq(supportTickets.id, id))
        .limit(1);

        if (ticket?.contactId) {
          const [contact] = await db.select({
            email: contacts.email,
            firstName: contacts.firstName,
          })
          .from(contacts)
          .where(eq(contacts.id, ticket.contactId))
          .limit(1);

          if (contact?.email) {
            const token = randomBytes(24).toString('hex');
            await tx.insert(csatSurveys).values({
              tenantId: ctx.tenantId,
              ticketId: id,
              contactId: ticket.contactId,
              token,
            });

            surveyToken = token;
            surveyContactEmail = contact.email;
            surveyContactName = contact.firstName;
            ticketSubject = ticket.subject;
          }
        }
      }
    });

    // Send CSAT survey email after transaction commits
    if (surveyToken && surveyContactEmail && ticketSubject) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const surveyUrl = `${baseUrl}/public/csat/${surveyToken}`;
      const name = surveyContactName || 'there';

      sendEmail({
        to: surveyContactEmail,
        subject: `How was your support experience? — ${ticketSubject}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">Hi ${name},</h2>
            <p style="color: #555; margin-bottom: 24px;">Your support ticket <strong>${ticketSubject}</strong> has been resolved. We'd love to hear your feedback!</p>
            <div style="background: #f8f8f8; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <p style="color: #333; font-size: 16px; margin-bottom: 16px;">How would you rate your experience?</p>
              <a href="${surveyUrl}?score=1" style="font-size: 32px; text-decoration: none; margin: 0 4px;">😞</a>
              <a href="${surveyUrl}?score=2" style="font-size: 32px; text-decoration: none; margin: 0 4px;">😕</a>
              <a href="${surveyUrl}?score=3" style="font-size: 32px; text-decoration: none; margin: 0 4px;">😐</a>
              <a href="${surveyUrl}?score=4" style="font-size: 32px; text-decoration: none; margin: 0 4px;">😊</a>
              <a href="${surveyUrl}?score=5" style="font-size: 32px; text-decoration: none; margin: 0 4px;">😄</a>
            </div>
            <p style="color: #999; font-size: 12px;">Your feedback helps us improve our support quality.</p>
          </div>
        `,
      }).catch((err) => {
        logger.warn('[ticket-survey] Failed to send satisfaction survey', {
          ticketId: id, error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Fetch updated ticket to return in response
    const [updatedTicket] = await db.select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      body: supportTickets.body,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      assignedTo: supportTickets.assignedTo,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)))
    .limit(1);

    return NextResponse.json({ data: updatedTicket ?? { id } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'ticket PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'tickets', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const now = new Date();
    await db.update(supportTickets).set({ deletedAt: now, updatedAt: now }).where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)));

    return NextResponse.json({ data: { id, deleted: true } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'ticket DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});

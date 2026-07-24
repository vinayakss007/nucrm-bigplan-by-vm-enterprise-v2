import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { updateTicketSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies, contacts, users, csatSurveys } from '@/drizzle/schema';
import { eq, and, asc } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { randomBytes } from 'crypto';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      assigned_name: users.fullName,
    })
    .from(supportTickets)
    .leftJoin(contacts, eq(contacts.id, supportTickets.contactId))
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

    return NextResponse.json({ data: { ...ticket, replies } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ticket GET]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const body = await request.json();
    const validated = validateBody(updateTicketSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

 
 
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

    await db.update(supportTickets)
      .set(updates)
      .where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)));

    // Send CSAT survey when ticket is resolved
    if (v.status === 'resolved') {
      const [ticket] = await db.select({
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
          const [survey] = await db.insert(csatSurveys).values({
            tenantId: ctx.tenantId,
            ticketId: id,
            contactId: ticket.contactId,
            token,
          }).returning();

          if (survey) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            const surveyUrl = `${baseUrl}/public/csat/${token}`;
            const name = contact.firstName || 'there';

            sendEmail({
              to: contact.email,
              subject: `How was your support experience? — ${ticket.subject}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
                  <h2 style="color: #1a1a1a; margin-bottom: 8px;">Hi ${name},</h2>
                  <p style="color: #555; margin-bottom: 24px;">Your support ticket <strong>${ticket.subject}</strong> has been resolved. We'd love to hear your feedback!</p>
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
            }).catch(() => {}); // fire-and-forget
          }
        }
      }
    }

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ticket PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    await db.delete(supportTickets).where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)));

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ticket DELETE]', err);
    return apiError(err);
  }
}

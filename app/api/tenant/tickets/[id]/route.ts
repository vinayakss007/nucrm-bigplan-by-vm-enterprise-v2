import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { updateTicketSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { supportTickets, ticketReplies, contacts, users } from '@/drizzle/schema';
import { eq, and, asc } from 'drizzle-orm';

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
    .where(eq(ticketReplies.ticketId, id))
    .orderBy(asc(ticketReplies.createdAt));

    return NextResponse.json({ data: { ...ticket, replies } });
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

    const updates: Record<string, any> = {};

    if (v.status) updates['status'] = v.status;
    if (v.priority) updates['priority'] = v.priority;
    if (v.assigned_to) updates['assignedTo'] = v.assigned_to;

    await db.update(supportTickets)
      .set(updates)
      .where(and(eq(supportTickets.tenantId, ctx.tenantId), eq(supportTickets.id, id)));

    return NextResponse.json({ success: true });
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
  } catch (err: any) {
    console.error('[ticket DELETE]', err);
    return apiError(err);
  }
}

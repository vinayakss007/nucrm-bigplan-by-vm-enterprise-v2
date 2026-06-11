import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';
import { validateBody, validateQuery } from '@/lib/api/validate';
import { createTicketSchema, ticketQuerySchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, requireModule } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { supportTickets, contacts, users } from '@/drizzle/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';

/**
 * Tenant Ticket Management
 * Restricted to Organizations with the 'service-helpdesk' module active.
 */
export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, { action: 'get', max: 120, windowMinutes: 1 }); if (limited) return limited;
  return _GET(request);
}

async function _GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'service-helpdesk');
    if (modErr) return modErr;

    const permErr = requirePerm(ctx, 'tickets.view');
    if (permErr) return permErr;

    const { searchParams } = new URL(request.url);
    const qParams = Object.fromEntries(searchParams.entries());
    const qValidated = validateQuery(ticketQuerySchema, qParams);
    const q = qValidated instanceof NextResponse
      ? { offset: 0, limit: 50 }
      : qValidated.data;
    const status = searchParams.get('status');
    const contactId = searchParams.get('contact_id');
    const limit = Math.min(100, q.limit);
    const offset = q.offset;

    const filters = [
      eq(supportTickets.tenantId, ctx.tenantId),
      isNull(supportTickets.deletedAt),
      status ? eq(supportTickets.status, status) : null,
      contactId ? eq(supportTickets.contactId, contactId) : null
    ].filter((x): x is NonNullable<typeof x> => x != null);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(supportTickets)
      .where(and(...filters));

    const query = db.select({
      id: supportTickets.id,
      tenantId: supportTickets.tenantId,
      contactId: supportTickets.contactId,
      subject: supportTickets.subject,
      body: supportTickets.body,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      assignedTo: supportTickets.assignedTo,
      createdAt: supportTickets.createdAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      assignedName: users.fullName,
    })
    .from(supportTickets)
    .leftJoin(contacts, eq(contacts.id, supportTickets.contactId))
    .leftJoin(users, eq(users.id, supportTickets.assignedTo))
    .where(and(...filters))
    .orderBy(desc(supportTickets.createdAt))
    .limit(limit)
    .offset(offset);

    const data = await query;

    return NextResponse.json({ data, total: countResult?.count ?? 0, limit, offset });
  } catch (err: any) {
    console.error('[tenant tickets GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'service-helpdesk');
    if (modErr) return modErr;

    const permErr = requirePerm(ctx, 'tickets.manage');
    if (permErr) return permErr;

    const body = await request.json();
    const validated = validateBody(createTicketSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(supportTickets)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        contactId: v.contact_id || null,
        subject: v.subject,
        body: v.description,
        category: v.category || 'general',
        priority: v.priority,
        status: v.status,
      } as typeof supportTickets.$inferInsert)
      .returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    console.error('[tenant tickets POST]', err);
    return apiError(err);
  }
}

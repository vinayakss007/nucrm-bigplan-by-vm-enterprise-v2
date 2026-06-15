import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { createFollowUpSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { followUps, contacts, leads, deals, users } from '@/drizzle/schema';
import { eq, and, isNull, desc, asc, gte, lte, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100'));
    const offset = parseInt(searchParams.get('offset') ?? '0');
    const status = searchParams.get('status');
    const leadId = searchParams.get('lead_id');
    const contactId = searchParams.get('contact_id');
    const dealId = searchParams.get('deal_id');
    const assignedTo = searchParams.get('assigned_to');
    const dueBefore = searchParams.get('due_before');
    const dueAfter = searchParams.get('due_after');
    const missedOnly = searchParams.get('missed_only') === 'true';

    const filters = [
      eq(followUps.tenantId, ctx.tenantId),
      isNull(followUps.deletedAt),
    ];

    if (status) filters.push(eq(followUps.status, status));
    if (leadId) filters.push(eq(followUps.leadId, leadId));
    if (contactId) filters.push(eq(followUps.contactId, contactId));
    if (dealId) filters.push(eq(followUps.dealId, dealId));
    if (assignedTo) filters.push(eq(followUps.assignedTo, assignedTo));
    if (dueBefore) filters.push(lte(followUps.dueDate, new Date(dueBefore)));
    if (dueAfter) filters.push(gte(followUps.dueDate, new Date(dueAfter)));
    if (missedOnly) {
      filters.push(
        eq(followUps.status, 'pending'),
        lte(followUps.dueDate, new Date())
      );
    }

    const [countRes] = await db.select({
      count: sql<number>`count(*)::int`,
    })
    .from(followUps)
    .where(and(...filters));

    const data = await db.select({
      id: followUps.id,
      title: followUps.title,
      description: followUps.description,
      dueDate: followUps.dueDate,
      status: followUps.status,
      missedDays: followUps.missedDays,
      autoAiEnabled: followUps.autoAiEnabled,
      completedAt: followUps.completedAt,
      leadId: followUps.leadId,
      contactId: followUps.contactId,
      dealId: followUps.dealId,
      assignedTo: followUps.assignedTo,
      createdAt: followUps.createdAt,
      contactName: sql<string>`CASE WHEN ${contacts.id} IS NOT NULL THEN ${contacts.firstName} || ' ' || COALESCE(${contacts.lastName}, '') END`,
      leadName: sql<string>`CASE WHEN ${leads.id} IS NOT NULL THEN ${leads.firstName} || ' ' || COALESCE(${leads.lastName}, '') END`,
      dealTitle: deals.title,
      assigneeName: users.fullName,
    })
    .from(followUps)
    .leftJoin(contacts, eq(contacts.id, followUps.contactId))
    .leftJoin(leads, eq(leads.id, followUps.leadId))
    .leftJoin(deals, eq(deals.id, followUps.dealId))
    .leftJoin(users, eq(users.id, followUps.assignedTo))
    .where(and(...filters))
    .orderBy(asc(followUps.dueDate), desc(followUps.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({ data, total: countRes?.count ?? 0 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[follow-ups GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const validated = validateBody(createFollowUpSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [newFollowUp] = await db.insert(followUps)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        title: v.title,
        description: v.description || null,
        dueDate: v.due_date ? new Date(v.due_date) : new Date(Date.now() + 86400000),
        leadId: v.lead_id || null,
        contactId: v.contact_id || null,
        dealId: v.deal_id || null,
        assignedTo: v.assigned_to || ctx.userId,
        status: v.status || 'pending',
        autoAiEnabled: v.auto_ai_enabled || false,
      })
      .returning();

    return NextResponse.json({ data: newFollowUp }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[follow-ups POST]', err);
    return apiError(err);
  }
}

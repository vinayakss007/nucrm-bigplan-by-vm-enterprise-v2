import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateMeetingSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { meetings, contacts } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { withConcurrencyGuard } from '@/lib/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(_request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [row] = await db.select({
      id: meetings.id,
      tenantId: meetings.tenantId,
      userId: meetings.userId,
      contactId: meetings.contactId,
      dealId: meetings.dealId,
      title: meetings.title,
      description: meetings.description,
      startTime: meetings.startTime,
      endTime: meetings.endTime,
      location: meetings.location,
      meetingUrl: meetings.meetingUrl,
      status: meetings.status,
      createdAt: meetings.createdAt,
      updatedAt: meetings.updatedAt,
      contact_name: sql<string>`COALESCE(${contacts.firstName} || ' ' || ${contacts.lastName}, '')`,
    })
    .from(meetings)
    .leftJoin(contacts, eq(contacts.id, meetings.contactId))
    .where(and(eq(meetings.id, id), eq(meetings.tenantId, ctx.tenantId), isNull(meetings.deletedAt)))
    .limit(1);

    if (!row) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
  const limited = await rateLimitMutating(request, 'meetings', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    const body = await readJsonBody(request);
    const validated = validateBody(updateMeetingSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [existing] = await db.select({ id: meetings.id, updatedAt: meetings.updatedAt })
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, ctx.tenantId), isNull(meetings.deletedAt)))
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = { updatedAt: new Date() };
    if (v.title !== undefined) updates.title = v.title;
    if (v.description !== undefined) updates.description = v.description ?? null;
    if (v.start_time !== undefined) updates.startTime = new Date(v.start_time);
    if (v.end_time !== undefined) updates.endTime = v.end_time ? new Date(v.end_time) : null;
    if (v.location !== undefined) updates.location = v.location ?? null;
    if (v.meeting_url !== undefined) updates.meetingUrl = v.meeting_url ?? null;
    if (v.contact_id !== undefined) updates.contactId = v.contact_id ?? null;
    if (v.deal_id !== undefined) updates.dealId = v.deal_id ?? null;
    if (v.status !== undefined) updates.status = v.status;

    const [updated] = await withConcurrencyGuard(
      () => db.update(meetings)
        .set(updates)
        .where(and(eq(meetings.id, id), eq(meetings.updatedAt, existing.updatedAt!), isNull(meetings.deletedAt)))
        .returning(),
      'Meeting',
      existing.updatedAt!,
    );

    return NextResponse.json({ data: updated });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
  const limited = await rateLimitMutating(_request, 'meetings', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(_request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [existing] = await db.select({ id: meetings.id })
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, ctx.tenantId), isNull(meetings.deletedAt)))
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    await db.update(meetings)
      .set({ deletedAt: new Date() })
      .where(eq(meetings.id, id));

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}

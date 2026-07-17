import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { callLogs } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const updateCallSchema = z.object({
  direction: z.enum(['inbound', 'outbound']).optional(),
  duration: z.number().int().min(0).optional(),
  notes: z.string().max(5000).optional().nullable(),
  phone_number: z.string().max(30).optional().nullable(),
  recorded_url: z.string().max(500).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id } = await params;
    const raw = await req.json();
    const parsed = validateBody(updateCallSchema, raw);
    if (parsed instanceof NextResponse) return parsed;

    const [existing] = await db.select({ id: callLogs.id })
      .from(callLogs)
      .where(and(eq(callLogs.id, id), eq(callLogs.tenantId, ctx.tenantId), isNull(callLogs.deletedAt)))
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.direction !== undefined) updateData.direction = d.direction;
    if (d.duration !== undefined) updateData.duration = d.duration;
    if (d.notes !== undefined) updateData.notes = d.notes;
    if (d.phone_number !== undefined) updateData.phoneNumber = d.phone_number;
    if (d.recorded_url !== undefined) updateData.recordedUrl = d.recorded_url;
    if (d.assigned_to !== undefined) updateData.assignedTo = d.assigned_to;

    const [row] = await db.update(callLogs)
      .set(updateData)
      .where(eq(callLogs.id, id))
      .returning();

    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.delete');
    if (deny) return deny;

    const { id } = await params;

    const [row] = await db.update(callLogs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(callLogs.id, id), eq(callLogs.tenantId, ctx.tenantId), isNull(callLogs.deletedAt)))
      .returning({ id: callLogs.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}

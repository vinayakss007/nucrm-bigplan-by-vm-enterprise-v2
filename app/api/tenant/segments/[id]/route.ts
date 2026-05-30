import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { updateSegmentSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { segments } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [segment] = await db.select().from(segments).where(
      and(eq(segments.id, id), eq(segments.tenantId, tenantId), isNull(segments.deletedAt))
    );

    if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: segment });
  } catch (error: any) {
    console.error('[segments/[id]/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const rawBody = await request.json();
    const validated = validateBody(updateSegmentSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: any = { updatedAt: new Date(), updatedBy: userId };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.entity_type !== undefined) updateData.entityType = v.entity_type;
    if (v.config !== undefined) updateData.config = v.config;

    const [segment] = await db.update(segments)
      .set(updateData)
      .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), isNull(segments.deletedAt)))
      .returning();

    if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: segment });
  } catch (error: any) {
    console.error('[segments/[id]/PATCH]', error);
    return NextResponse.json({ error: 'Failed to update segment' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const [segment] = await db.update(segments)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), isNull(segments.deletedAt)))
      .returning({ id: segments.id });

    if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[segments/[id]/DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete segment' }, { status: 500 });
  }
}

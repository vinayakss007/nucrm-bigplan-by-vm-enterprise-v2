import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { updateServiceCategorySchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { serviceCategories } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [category] = await db.select().from(serviceCategories).where(
      and(eq(serviceCategories.id, id), eq(serviceCategories.tenantId, tenantId), isNull(serviceCategories.deletedAt))
    );

    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: category });
  } catch (error: any) {
    console.error('[service-categories/[id]/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch service category' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const rawBody = await request.json();
    const validated = validateBody(updateServiceCategorySchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: any = { updatedAt: new Date(), updatedBy: userId };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.color !== undefined) updateData.color = v.color;
    if (v.icon !== undefined) updateData.icon = v.icon;
    if (v.sort_order !== undefined) updateData.sortOrder = v.sort_order;

    const [category] = await db.update(serviceCategories)
      .set(updateData)
      .where(and(eq(serviceCategories.id, id), eq(serviceCategories.tenantId, tenantId), isNull(serviceCategories.deletedAt)))
      .returning();

    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: category });
  } catch (error: any) {
    console.error('[service-categories/[id]/PATCH]', error);
    return NextResponse.json({ error: 'Failed to update service category' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const [category] = await db.update(serviceCategories)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(and(eq(serviceCategories.id, id), eq(serviceCategories.tenantId, tenantId), isNull(serviceCategories.deletedAt)))
      .returning({ id: serviceCategories.id });

    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[service-categories/[id]/DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete service category' }, { status: 500 });
  }
}

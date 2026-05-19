import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { kbCategories } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body['name']) updates['name'] = body['name'];
    if (body['description'] !== undefined) updates['description'] = body['description'];
    if (body['icon']) updates['icon'] = body['icon'];
    if (body['order'] !== undefined) updates['order'] = body['order'];
    if (body['slug']) updates['slug'] = body['slug'];

    await db.update(kbCategories).set(updates)
      .where(and(eq(kbCategories.tenantId, ctx.tenantId), eq(kbCategories.id, id)));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    await db.update(kbCategories).set({ deletedAt: new Date() })
      .where(and(eq(kbCategories.tenantId, ctx.tenantId), eq(kbCategories.id, id)));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err);
  }
}

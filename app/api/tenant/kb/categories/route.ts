import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { kbCategories } from '@/drizzle/schema';
import { eq, and, asc, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await db.select()
      .from(kbCategories)
      .where(and(eq(kbCategories.tenantId, ctx.tenantId), isNull(kbCategories.deletedAt)))
      .orderBy(asc(kbCategories.order));
    return NextResponse.json({ data });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const slug = body.slug || body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const [row] = await db.insert(kbCategories).values({
      tenantId: ctx.tenantId, createdBy: ctx.userId,
      name: body.name, slug, description: body.description, icon: body.icon, order: body.order || 0,
    }).returning();
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}

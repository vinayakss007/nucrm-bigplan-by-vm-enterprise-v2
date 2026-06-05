import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createPlanSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { announcements } from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    const data = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        type: announcements.type,
        is_active: announcements.isActive,
        target: announcements.target,
        starts_at: announcements.startsAt,
        ends_at: announcements.endsAt,
        created_at: announcements.createdAt,
        updated_at: announcements.updatedAt,
      })
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(50)
      .catch(() => []);
    
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[superadmin/announcements GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    const rawBody = await request.json();
    const validated = validateBody(createPlanSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const b = rawBody;
    if (!b.title || !b.body) return NextResponse.json({ error: 'title and body required' }, { status: 400 });

    const [row] = await db
      .insert(announcements)
      .values({
        title: b.title,
        body: b.body,
        type: b.type || 'info',
        target: b.target || 'all',
        isActive: b.is_active ?? true,
        startsAt: b.starts_at ? new Date(b.starts_at) : new Date(),
        endsAt: b.ends_at ? new Date(b.ends_at) : null,
        createdBy: ctx.userId,
      })
      .returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    console.error('[superadmin/announcements POST]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id, is_active } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const [row] = await db
      .update(announcements)
      .set({ isActive: is_active ?? true })
      .where(eq(announcements.id, id))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, data: row });
  } catch (err: any) {
    console.error('[superadmin/announcements PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await db.delete(announcements).where(eq(announcements.id, id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[superadmin/announcements DELETE]', err);
    return apiError(err);
  }
}


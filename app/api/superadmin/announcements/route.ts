import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { announcements } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createAnnouncementSchema, updateAnnouncementSchema, deleteAnnouncementSchema } from '@/lib/api/schemas';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { concurrencyGuardById } from '@/lib/api/concurrency';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    const data = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        content: announcements.content,
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
      .catch((err) => { console.error('[announcements] list failed', err); return []; });
    
    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    
    const b = await readJsonBody(request);
    const result = validateBody(createAnnouncementSchema, b);
    if (result instanceof NextResponse) return result;
    const content = result.data.body || result.data.content;
    if (!content) return NextResponse.json({ error: 'body or content is required' }, { status: 400 });

    const [row] = await db
      .insert(announcements)
      .values({
        title: result.data.title,
        content: content,
        type: result.data.type,
        target: result.data.target,
        isActive: result.data.is_active,
        startsAt: result.data.starts_at ? new Date(result.data.starts_at) : new Date(),
        endsAt: result.data.ends_at ? new Date(result.data.ends_at) : null,
        createdBy: ctx.userId,
      })
      .returning();

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'settings.changed',
      targetType: 'announcement',
      targetId: row?.id,
      targetName: result.data.title,
      metadata: { type: result.data.type, target: result.data.target },
    });

    return NextResponse.json({ data: row }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const b = await readJsonBody(request);
    const result = validateBody(updateAnnouncementSchema, b);
    if (result instanceof NextResponse) return result;

    const [existing] = await db
      .select({ updatedAt: announcements.updatedAt })
      .from(announcements)
      .where(eq(announcements.id, result.data.id))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const guard = await concurrencyGuardById(db, announcements, result.data.id, existing.updatedAt);
    if (guard) return guard;

    const [row] = await db
      .update(announcements)
      .set({ isActive: result.data.is_active, updatedAt: new Date() })
      .where(eq(announcements.id, result.data.id))
      .returning();

    if (!row) return NextResponse.json({ error: 'Announcement was modified by another user — please refresh' }, { status: 409 });

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'settings.changed',
      targetType: 'announcement',
      targetId: row.id,
      targetName: row.title,
      metadata: { is_active: result.data.is_active },
    });

    return NextResponse.json({ ok: true, data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    
    const b = await readJsonBody(request);
    const result = validateBody(deleteAnnouncementSchema, b);
    if (result instanceof NextResponse) return result;

    await db.delete(announcements).where(eq(announcements.id, result.data.id));

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'settings.changed',
      targetType: 'announcement',
      targetId: result.data.id,
      metadata: { deleted: true },
    });

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/announcements DELETE]', err);
    return apiError(err);
  }
}


/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { announcements } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createAnnouncementSchema, updateAnnouncementSchema, deleteAnnouncementSchema } from '@/lib/api/schemas';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { concurrencyGuardById } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
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
      .catch((err) => { void logError({ error: err, context: 'superadmin/announcements list query' }); return []; });
    
    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/announcements GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
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
    await logError({ error: err, context: 'superadmin/announcements POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
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

    const expectedUpdatedAt = new Date(result.data.updated_at ?? existing.updatedAt!);
    const guard = await concurrencyGuardById(db, announcements, result.data.id, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db
      .update(announcements)
      .set({ isActive: result.data.is_active, updatedAt: new Date() })
      .where(and(eq(announcements.id, result.data.id), eq(announcements.updatedAt, expectedUpdatedAt)))
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
    await logError({ error: err, context: 'superadmin/announcements PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
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
    await logError({ error: err, context: 'superadmin/announcements DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});


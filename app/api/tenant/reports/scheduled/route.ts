import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { scheduledReports } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const reports = await db.select()
      .from(scheduledReports)
      .where(and(
        eq(scheduledReports.tenantId, ctx.tenantId),
        isNull(scheduledReports.deletedAt)
      ))
      .orderBy(desc(scheduledReports.createdAt));

    return NextResponse.json({ data: reports });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[scheduled reports GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'reports.create');
    if (deny) return deny;

    const body = await request.json();
    if (!body.name || !body.type || !body.frequency) {
      return NextResponse.json({ error: 'Name, type, and frequency required' }, { status: 400 });
    }

    const now = new Date();
    const nextRun = new Date(now);
    switch (body.frequency) {
      case 'hourly': nextRun.setHours(nextRun.getHours() + 1); break;
      case 'daily': nextRun.setDate(nextRun.getDate() + 1); break;
      case 'weekly': nextRun.setDate(nextRun.getDate() + 7); break;
      case 'monthly': nextRun.setMonth(nextRun.getMonth() + 1); break;
    }

    const [report] = await db.insert(scheduledReports).values({
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      name: body.name,
      type: body.type,
      frequency: body.frequency,
      recipients: body.recipients || [],
      config: body.config || {},
      format: body.format || 'csv',
      nextRunAt: nextRun,
    }).returning();

    return NextResponse.json({ data: report }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[scheduled reports POST]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    await db.update(scheduledReports)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(scheduledReports.tenantId, ctx.tenantId),
        eq(scheduledReports.id, id)
      ));

    return NextResponse.json({ success: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await request.json();
    await db.update(scheduledReports)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(scheduledReports.tenantId, ctx.tenantId),
        eq(scheduledReports.id, id)
      ));

    return NextResponse.json({ success: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

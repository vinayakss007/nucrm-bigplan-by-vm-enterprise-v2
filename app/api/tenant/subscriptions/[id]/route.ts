import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { serviceSubscriptions } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const subId = (await params).id;

    const [row] = await db
      .select()
      .from(serviceSubscriptions)
      .where(
        and(
          eq(serviceSubscriptions.id, subId),
          eq(serviceSubscriptions.tenantId, ctx.tenantId),
          sql`${serviceSubscriptions.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[subscriptions [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const subId = (await params).id;
    const body = await req.json();

    const allowedFields: Record<string, any> = {};
    const mutable = ['name', 'planName', 'status', 'amount', 'billingFrequency', 'autoRenew', 'currentPeriodEnd', 'cancelledAt'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: serviceSubscriptions.id })
      .from(serviceSubscriptions)
      .where(
        and(
          eq(serviceSubscriptions.id, subId),
          eq(serviceSubscriptions.tenantId, ctx.tenantId),
          sql`${serviceSubscriptions.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await db
      .update(serviceSubscriptions)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(serviceSubscriptions.id, subId), eq(serviceSubscriptions.tenantId, ctx.tenantId)))
      .returning();

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[subscriptions [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const subId = (await params).id;

    const [row] = await db
      .update(serviceSubscriptions)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        status: 'cancelled',
        cancelledAt: new Date(),
      })
      .where(
        and(
          eq(serviceSubscriptions.id, subId),
          eq(serviceSubscriptions.tenantId, ctx.tenantId),
          sql`${serviceSubscriptions.deletedAt} IS NULL`
        )
      )
      .returning({ id: serviceSubscriptions.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
  } catch (err: any) {
    console.error('[subscriptions [id] DELETE]', err);
    return apiError(err);
  }
}

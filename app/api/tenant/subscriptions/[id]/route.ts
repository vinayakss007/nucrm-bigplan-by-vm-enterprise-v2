import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { serviceSubscriptions } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'subscriptions.view');
    if (deny) return deny;

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[subscriptions [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'subscriptions.edit');
    if (deny) return deny;

    const subId = (await params).id;
    const body = await req.json();

    // Validate numeric fields
    if (body.amount !== undefined) {
      const v = parseFloat(body.amount);
      if (isNaN(v)) {
        return NextResponse.json({ error: 'amount must be a valid number' }, { status: 400 });
      }
      body.amount = v;
    }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'subscription.updated',
      entityType: 'subscription',
      entityId: subId,
      metadata: { changes: allowedFields },
    });

    return NextResponse.json({ data: updated });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[subscriptions [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'subscriptions.delete');
    if (deny) return deny;

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

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'subscription.deleted',
      entityType: 'subscription',
      entityId: subId,
    });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[subscriptions [id] DELETE]', err);
    return apiError(err);
  }
}

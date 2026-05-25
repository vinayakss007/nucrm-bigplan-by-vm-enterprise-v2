import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contracts } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const contractId = (await params).id;

    const [row] = await db
      .select()
      .from(contracts)
      .where(
        and(
          eq(contracts.id, contractId),
          eq(contracts.tenantId, ctx.tenantId),
          sql`${contracts.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[contracts [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const contractId = (await params).id;
    const body = await req.json();

    const allowedFields: Record<string, any> = {};
    const mutable = ['title', 'status', 'contractType', 'startDate', 'endDate', 'totalValue', 'terms', 'notes', 'billingFrequency'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(
        and(
          eq(contracts.id, contractId),
          eq(contracts.tenantId, ctx.tenantId),
          sql`${contracts.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await db
      .update(contracts)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, ctx.tenantId)))
      .returning();

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[contracts [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const contractId = (await params).id;

    const [row] = await db
      .update(contracts)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(
        and(
          eq(contracts.id, contractId),
          eq(contracts.tenantId, ctx.tenantId),
          sql`${contracts.deletedAt} IS NULL`
        )
      )
      .returning({ id: contracts.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
  } catch (err: any) {
    console.error('[contracts [id] DELETE]', err);
    return apiError(err);
  }
}

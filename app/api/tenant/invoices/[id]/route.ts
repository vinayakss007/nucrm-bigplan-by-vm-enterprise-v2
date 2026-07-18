import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invoices } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'invoices.view');
    if (deny) return deny;

    const invoiceId = (await params).id;

    const [row] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
          sql`${invoices.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[invoices [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'invoices.edit');
    if (deny) return deny;

    const invoiceId = (await params).id;
    const body = await req.json();

    const numericFields = ['subtotal', 'discountAmount', 'taxAmount', 'totalAmount', 'amountPaid', 'balanceDue'] as const;
    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const v = parseFloat(body[field]);
        if (isNaN(v)) {
          return NextResponse.json({ error: `${field} must be a valid number` }, { status: 400 });
        }
        body[field] = v;
      }
    }



// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowedFields: Record<string, any> = {};
    const mutable = ['title', 'status', 'subtotal', 'discountType', 'discountValue', 'discountAmount', 'taxRate', 'taxAmount', 'totalAmount', 'amountPaid', 'balanceDue', 'notes', 'terms', 'footer', 'issueDate', 'dueDate', 'paymentMethod', 'paymentReference'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    // Handle status-specific timestamp updates
    if (body.status === 'sent' && !body.sentAt) {
      allowedFields['sentAt'] = new Date();
    }
    if (body.status === 'paid' && !body.paidAt) {
      allowedFields['paidAt'] = new Date();
    }
    if (body.status === 'cancelled' && !body.cancelledAt) {
      allowedFields['cancelledAt'] = new Date();
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
          sql`${invoices.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await db
      .update(invoices)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)))
      .returning();

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { changes: allowedFields },
    });

    return NextResponse.json({ data: updated });


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[invoices [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'invoices.delete');
    if (deny) return deny;

    const invoiceId = (await params).id;

    const [row] = await db
      .update(invoices)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        status: 'cancelled',
      })
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
          sql`${invoices.deletedAt} IS NULL`
        )
      )
      .returning({ id: invoices.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.deleted',
      entityType: 'invoice',
      entityId: invoiceId,
    });

    return NextResponse.json({ data: { id: row.id, deleted: true } });


// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[invoices [id] DELETE]', err);
    return apiError(err);
  }
}

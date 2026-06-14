import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'quotes.view');
    if (deny) return deny;

    const quoteId = (await params).id;

    const [row] = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.tenantId, ctx.tenantId),
          sql`${quotes.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[quotes [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'quotes.edit');
    if (deny) return deny;

    const quoteId = (await params).id;
    const body = await req.json();

    // Validate numeric fields
    const numericFields = ['subtotal', 'discount', 'tax', 'totalAmount'] as const;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowedFields: Record<string, any> = {};
    const mutable = ['title', 'status', 'subtotal', 'discount', 'tax', 'totalAmount', 'expiresAt', 'notes', 'terms'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    // Handle status-specific timestamp updates
    if (body.status === 'sent' && !body.sentAt) {
      allowedFields['sentAt'] = new Date();
    }
    if (body.status === 'accepted' && !body.acceptedAt) {
      allowedFields['acceptedAt'] = new Date();
    }
    if (body.status === 'declined' && !body.declinedAt) {
      allowedFields['declinedAt'] = new Date();
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.tenantId, ctx.tenantId),
          sql`${quotes.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await db
      .update(quotes)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(quotes.id, quoteId), eq(quotes.tenantId, ctx.tenantId)))
      .returning();

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'quote.updated',
      entityType: 'quote',
      entityId: quoteId,
      metadata: { changes: allowedFields },
    });

    return NextResponse.json({ data: updated });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[quotes [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'quotes.delete');
    if (deny) return deny;

    const quoteId = (await params).id;

    const [row] = await db
      .update(quotes)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        status: 'cancelled',
      })
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.tenantId, ctx.tenantId),
          sql`${quotes.deletedAt} IS NULL`
        )
      )
      .returning({ id: quotes.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'quote.deleted',
      entityType: 'quote',
      entityId: quoteId,
    });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[quotes [id] DELETE]', err);
    return apiError(err);
  }
}

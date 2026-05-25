import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

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
  } catch (err: any) {
    console.error('[quotes [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const quoteId = (await params).id;
    const body = await req.json();

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

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[quotes [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

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

    return NextResponse.json({ data: { id: row.id, deleted: true } });
  } catch (err: any) {
    console.error('[quotes [id] DELETE]', err);
    return apiError(err);
  }
}

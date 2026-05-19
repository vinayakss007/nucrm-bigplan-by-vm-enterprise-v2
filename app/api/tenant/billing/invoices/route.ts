import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { billingEvents, tenants } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const events = await db.select({
      id: billingEvents.id,
      eventType: billingEvents.eventType,
      amount: billingEvents.amount,
      currency: billingEvents.currency,
      stripeInvoiceId: billingEvents.stripeInvoiceId,
      stripeSubscriptionId: billingEvents.stripeSubscriptionId,
      metadata: billingEvents.metadata,
      createdAt: billingEvents.createdAt,
    })
    .from(billingEvents)
    .where(and(
      eq(billingEvents.tenantId, ctx.tenantId),
      isNull(billingEvents.deletedAt)
    ))
    .orderBy(desc(billingEvents.createdAt))
    .limit(50);

    const formatted = events.map(e => ({
      id: e.id,
      type: e.eventType,
      amount: e.amount ? `$${Number(e.amount).toFixed(2)}` : '—',
      currency: e.currency || 'usd',
      invoiceId: e.stripeInvoiceId,
      subscriptionId: e.stripeSubscriptionId,
      date: e.createdAt,
      invoiceUrl: e.stripeInvoiceId ? `https://dashboard.stripe.com/invoices/${e.stripeInvoiceId}` : null,
      status: e.eventType.includes('paid') || e.eventType.includes('succeeded') ? 'paid' :
              e.eventType.includes('failed') ? 'failed' :
              e.eventType.includes('past_due') ? 'past_due' : 'pending',
    }));

    return NextResponse.json({ data: formatted });
  } catch (err: any) {
    console.error('[billing invoices GET]', err);
    return apiError(err);
  }
}

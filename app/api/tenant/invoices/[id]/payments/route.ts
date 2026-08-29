/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Invoice payment ledger endpoints.
 *
 *   GET  /api/tenant/invoices/:id/payments   list payments
 *   POST /api/tenant/invoices/:id/payments   record a payment
 *
 * The invoice's amount_paid / balance_due / status are DERIVED from this ledger
 * (see lib/billing/payments.ts), never set by hand.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invoices } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import {
  listInvoicePayments,
  recordInvoicePayment,
  PaymentError,
} from '@/lib/billing/payments';
import { withApiRoute } from '@/lib/api/with-api-route';

const createPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(999_999_999),
  payment_date: z.string().date(),
  payment_method: z.string().max(50).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  allow_overpayment: z.boolean().optional().default(false),
});

/** Confirms the invoice exists in this tenant before touching its ledger. */
async function invoiceExists(invoiceId: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.tenantId, tenantId),
        sql`${invoices.deletedAt} IS NULL`
      )
    )
    .limit(1);
  return Boolean(row);
}

export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'invoices.view');
    if (deny) return deny;

    const invoiceId = (await params).id;
    if (!(await invoiceExists(invoiceId, ctx.tenantId))) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const payments = await listInvoicePayments(invoiceId, ctx.tenantId);
    return NextResponse.json({ data: payments, total: payments.length });
  } catch (err) {
    await logError({ error: err, context: 'tenant/invoices/[id]/payments GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'invoices', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    // Recording money received is an edit to the invoice's financial state.
    const deny = requirePerm(ctx, 'invoices.edit');
    if (deny) return deny;

    const invoiceId = (await params).id;
    const validated = validateBody(createPaymentSchema, await readJsonBody(req));
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const { payment, totals } = await recordInvoicePayment({
      invoiceId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      amount: v.amount,
      paymentDate: v.payment_date,
      paymentMethod: v.payment_method ?? null,
      reference: v.reference ?? null,
      notes: v.notes ?? null,
      allowOverpayment: v.allow_overpayment,
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.payment_recorded',
      entityType: 'invoice',
      entityId: invoiceId,
      newData: {
        paymentId: payment.id,
        amount: v.amount,
        paymentDate: v.payment_date,
        paymentMethod: v.payment_method ?? null,
      },
      metadata: {
        amountPaid: totals.amountPaid,
        balanceDue: totals.balanceDue,
        status: totals.status,
      },
    });

    return NextResponse.json({ data: { payment, invoice: totals } }, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError) {
      return apiError(err, err.message, err.status);
    }
    await logError({ error: err, context: 'tenant/invoices/[id]/payments POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

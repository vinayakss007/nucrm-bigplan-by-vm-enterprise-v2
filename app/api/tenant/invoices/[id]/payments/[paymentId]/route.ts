/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Invoice payment mutation endpoints.
 *
 *   PATCH  /api/tenant/invoices/:id/payments/:paymentId   correct a mis-keyed payment (#2289)
 *   DELETE /api/tenant/invoices/:id/payments/:paymentId   void a payment
 *
 * Voids a payment. Soft delete, not hard: a payment that was recorded and
 * reversed is part of the financial history, and audit_logs alone cannot
 * reconstruct its amount and date. The invoice summary is recomputed from the
 * remaining live ledger rows in the same transaction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm, requireCsrf } from '@/lib/auth/middleware';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { envelope } from '@/lib/api/response-envelope';
import {
  updateInvoicePayment,
  voidInvoicePayment,
  PaymentError,
} from '@/lib/billing/payments';
import { withApiRoute } from '@/lib/api/with-api-route';

const updatePaymentSchema = z.object({
  amount: z.coerce.number().positive().max(999_999_999).optional(),
  payment_date: z.string().date().optional(),
  payment_method: z.string().max(50).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  allow_overpayment: z.boolean().optional().default(false),
});

/**
 * #2289: PATCH was missing entirely — a mis-keyed payment could only be voided
 * and re-created, which loses the row identity and recycles its reference
 * against the tenant-unique index. Partial-body semantics, mirroring the
 * sibling [id] PATCHes: only the fields present are written, and the invoice
 * summary is recomputed from the ledger in the same transaction
 * (lib/billing/payments.ts). Gated on invoices.edit like the POST that
 * recorded the payment in the first place.
 */
export const PATCH = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'invoices', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(req); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;

    const deny = requirePerm(ctx, 'invoices.edit');
    if (deny) return deny;

    const { id: invoiceId, paymentId } = await params;

    const validated = validateBody(updatePaymentSchema, await readJsonBody(req));
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    if (
      v.amount === undefined &&
      v.payment_date === undefined &&
      v.payment_method === undefined &&
      v.reference === undefined &&
      v.notes === undefined
    ) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { payment, totals } = await updateInvoicePayment({
      invoiceId,
      paymentId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      amount: v.amount,
      paymentDate: v.payment_date,
      paymentMethod: v.payment_method,
      reference: v.reference,
      notes: v.notes,
      allowOverpayment: v.allow_overpayment,
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.payment_updated',
      entityType: 'invoice',
      entityId: invoiceId,
      newData: {
        paymentId,
        amount: v.amount,
        paymentDate: v.payment_date,
        paymentMethod: v.payment_method,
      },
      metadata: {
        amountPaid: totals.amountPaid,
        balanceDue: totals.balanceDue,
        status: totals.status,
      },
    });

    return NextResponse.json(envelope({ payment, invoice: totals }));
  } catch (err) {
    if (err instanceof PaymentError) {
      return apiError(err, err.message, err.status);
    }
    await logError({ error: err, context: 'tenant/invoices/[id]/payments/[paymentId] PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'invoices', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    // Reversing a recorded payment changes revenue figures, so it is gated on
    // the stronger permission rather than invoices.edit.
    const deny = requirePerm(ctx, 'invoices.delete');
    if (deny) return deny;

    const { id: invoiceId, paymentId } = await params;

    const totals = await voidInvoicePayment({
      invoiceId,
      paymentId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.payment_voided',
      entityType: 'invoice',
      entityId: invoiceId,
      oldData: { paymentId },
      metadata: {
        amountPaid: totals.amountPaid,
        balanceDue: totals.balanceDue,
        status: totals.status,
      },
    });

    return NextResponse.json({ data: { voided: paymentId, invoice: totals } });
  } catch (err) {
    if (err instanceof PaymentError) {
      return apiError(err, err.message, err.status);
    }
    await logError({ error: err, context: 'tenant/invoices/[id]/payments/[paymentId] DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});

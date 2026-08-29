/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * DELETE /api/tenant/invoices/:id/payments/:paymentId
 *
 * Voids a payment. Soft delete, not hard: a payment that was recorded and
 * reversed is part of the financial history, and audit_logs alone cannot
 * reconstruct its amount and date. The invoice summary is recomputed from the
 * remaining live ledger rows in the same transaction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { voidInvoicePayment, PaymentError } from '@/lib/billing/payments';
import { withApiRoute } from '@/lib/api/with-api-route';

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

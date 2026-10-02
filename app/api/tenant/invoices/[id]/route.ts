/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm, requireCsrf } from '@/lib/auth/middleware';
import { documentTotal, money } from '@/lib/money';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { invoices } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { recalculateInvoicePayments } from '@/lib/billing/payments';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * #2226: statuses that describe how much the customer has actually paid.
 * They are computed from the invoice_payments ledger by
 * recalculateInvoicePayments() and must never be hand-set — a `paid` invoice
 * with zero recorded payments inflates revenue reports keyed on status.
 */
const LEDGER_OWNED_STATUSES = ['paid', 'partially_paid'] as const;

/**
 * #2226: fields the payment summary (amountPaid/balanceDue/status) is derived
 * from. Editing any of them must re-run recalculateInvoicePayments() in the
 * same transaction, otherwise a paid invoice whose totalAmount is raised keeps
 * a stale balanceDue and the ledger silently disagrees with the invoice.
 */
const LEDGER_AFFECTING_FIELDS = [
  'subtotal',
  'discountType',
  'discountValue',
  'discountAmount',
  'taxRate',
  'taxAmount',
  'totalAmount',
] as const;

export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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


  } catch (err) {
    await logError({ error: err, context: 'tenant/invoices/[id] GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const PUT = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'invoices', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(req); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;

    const deny = requirePerm(ctx, 'invoices.edit');
    if (deny) return deny;

    const invoiceId = (await params).id;
    const body = await readJsonBody(req);

    const numericFields = ['subtotal', 'discountAmount', 'taxAmount', 'totalAmount'] as const;
    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const v = parseFloat(body[field]);
        if (isNaN(v)) {
          return NextResponse.json({ error: `${field} must be a valid number` }, { status: 400 });
        }
        body[field] = v;
      }
    }

    // M-2: when the caller supplies subtotal + totalAmount, the total must equal
    // subtotal - discountAmount + taxAmount. Prevents a client PATCHing an
    // arbitrary totalAmount that disagrees with its components.
    if (body.subtotal !== undefined && body.totalAmount !== undefined) {
      const expected = documentTotal(body.subtotal, body.discountAmount ?? 0, body.taxAmount ?? 0);
      if (Math.abs(expected - money(body.totalAmount)) > 0.01) {
        return NextResponse.json(
          { error: `totalAmount (${money(body.totalAmount).toFixed(2)}) is inconsistent with subtotal - discountAmount + taxAmount (${expected.toFixed(2)})` },
          { status: 400 },
        );
      }
    }



    const allowedFields: Partial<typeof invoices.$inferInsert> = {};
    // amountPaid / balanceDue are deliberately NOT mutable here. They are
    // derived from the invoice_payments ledger (lib/billing/payments.ts) and
    // recomputed on every payment mutation. Allowing them to be set by hand is
    // how a summary ends up disagreeing with the payments that justify it, with
    // nothing to reconcile against. Use the payments endpoints instead:
    //   POST   /api/tenant/invoices/:id/payments
    //   DELETE /api/tenant/invoices/:id/payments/:paymentId
    const mutable = ['title', 'status', 'subtotal', 'discountType', 'discountValue', 'discountAmount', 'taxRate', 'taxAmount', 'totalAmount', 'notes', 'terms', 'footer', 'issueDate', 'dueDate', 'paymentMethod', 'paymentReference'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    // Reject rather than silently ignore, so an integration written against the
    // old behaviour finds out instead of believing it recorded a payment.
    for (const derived of ['amountPaid', 'balanceDue'] as const) {
      if (body[derived] !== undefined) {
        return NextResponse.json(
          {
            error:
              `${derived} is derived from the payment ledger and cannot be set directly. ` +
              `Record a payment via POST /api/tenant/invoices/${invoiceId}/payments.`,
          },
          { status: 422 }
        );
      }
    }

    // #2226: same reasoning as amountPaid/balanceDue above — 'paid' and
    // 'partially_paid' describe the ledger, so the payments endpoints own those
    // transitions. Left unchecked, status:'paid' could be set with zero
    // payments recorded (and paidAt auto-stamped below).
    if (typeof body.status === 'string' && (LEDGER_OWNED_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json(
        {
          error:
            `status '${body.status}' is derived from the payment ledger and cannot be set directly. ` +
            `Record a payment via POST /api/tenant/invoices/${invoiceId}/payments — ` +
            'amountPaid, balanceDue, status and paidAt are recomputed from it.',
        },
        { status: 422 }
      );
    }

    // Handle status-specific timestamp updates.
    // #2226: no paidAt stamping here — paidAt is owned by the ledger recalculation.
    if (body.status === 'sent' && !body.sentAt) {
      allowedFields['sentAt'] = new Date();
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
    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ?? body._updated_at;
    const guard = await concurrencyGuard(db, invoices, invoiceId, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;


    // #2226: when the money on the invoice changes, the payment summary derived
    // from it (amountPaid/balanceDue/status/paidAt) must be recomputed from the
    // ledger in the SAME transaction — otherwise a PATCHed totalAmount leaves a
    // stale balanceDue and revenue rows silently drift from the payments.
    const ledgerAffected = LEDGER_AFFECTING_FIELDS.some((field) => field in allowedFields);

    const patch = {
      ...allowedFields,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };

    let updated: typeof invoices.$inferSelect | undefined;
    if (ledgerAffected) {
      updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(invoices)
          .set(patch)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)))
          .returning();
        await recalculateInvoicePayments(tx, invoiceId, ctx.tenantId);
        // Re-read after the recalc so the response reflects the recomputed summary.
        const [fresh] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)))
          .limit(1);
        return fresh ?? row;
      });
    } else {
      [updated] = await db
        .update(invoices)
        .set(patch)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)))
        .returning();
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { changes: allowedFields },
    });

    return NextResponse.json({ data: updated });


  } catch (err) {
    await logError({ error: err, context: 'tenant/invoices/[id] PUT', requestMethod: 'PUT' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(req, 'invoices', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(req); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;

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

    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });


  } catch (err) {
    await logError({ error: err, context: 'tenant/invoices/[id] DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});

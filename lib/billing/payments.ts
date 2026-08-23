/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Invoice payment ledger.
 *
 * `invoice_payments` existed in the schema with no writer anywhere in the
 * codebase, while `invoices.amount_paid` / `invoices.balance_due` were listed
 * among the hand-editable fields on `PATCH /api/tenant/invoices/:id`. So the
 * only way to record that a customer had paid was to overwrite a summary number
 * by hand: no payment history, no partial-payment ledger, no record of who
 * entered it, and nothing to reconcile against.
 *
 * Every top-tier CRM treats payments as an append-only child ledger and DERIVES
 * the invoice summary from it. That is what this module does: the ledger is the
 * source of truth and `amount_paid` / `balance_due` / `status` / `paid_at` are
 * recomputed from it inside the same transaction as every mutation, so the
 * summary cannot drift from the payments that justify it.
 */

import { db } from '@/drizzle/db';
import { invoices, invoicePayments } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

/** Statuses that describe payment progress and may therefore be recomputed. */
const PAYMENT_DRIVEN_STATUSES = new Set(['draft', 'sent', 'partially_paid', 'paid', 'overdue']);

export interface InvoiceTotals {
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: string;
  paidAt: Date | null;
}

/** Money arrives from Postgres `decimal` as a string; normalise once. */
function money(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Round to cents so repeated float addition cannot drift. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recompute an invoice's payment summary FROM its ledger and persist it.
 *
 * Must be called inside the same transaction as the ledger mutation, otherwise
 * a concurrent write could leave the summary describing a different set of
 * payments than the one that exists.
 *
 * `status` is only ever moved between payment-driven values. A `cancelled` or
 * `void` invoice keeps its status: recording a refund against a cancelled
 * invoice should not quietly resurrect it as `sent`.
 */
export async function recalculateInvoicePayments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  invoiceId: string,
  tenantId: string
): Promise<InvoiceTotals> {
  const [invoice] = await tx
    .select({ totalAmount: invoices.totalAmount, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
    .limit(1);

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found for tenant`);

  const [sum] = await tx
    .select({ total: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)` })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.invoiceId, invoiceId),
        eq(invoicePayments.tenantId, tenantId),
        sql`${invoicePayments.deletedAt} IS NULL`
      )
    );

  const totalAmount = toCents(money(invoice.totalAmount));
  const amountPaid = toCents(money(sum?.total));
  const balanceDue = toCents(totalAmount - amountPaid);

  const currentStatus = String(invoice.status);
  let status = currentStatus;
  if (PAYMENT_DRIVEN_STATUSES.has(currentStatus)) {
    if (amountPaid <= 0) {
      // Fall back to 'sent' rather than 'draft': an invoice that had payments
      // removed has certainly been issued.
      status = currentStatus === 'draft' ? 'draft' : 'sent';
    } else if (balanceDue > 0) {
      status = 'partially_paid';
    } else {
      status = 'paid';
    }
  }

  // paid_at marks when the invoice was settled, so it is set only on full
  // settlement and cleared if the balance reopens.
  const paidAt = status === 'paid' ? new Date() : null;

  await tx
    .update(invoices)
    .set({
      amountPaid: amountPaid.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      status,
      paidAt,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));

  return { totalAmount, amountPaid, balanceDue, status, paidAt };
}

export interface RecordPaymentInput {
  invoiceId: string;
  tenantId: string;
  userId: string;
  amount: number;
  paymentDate: string;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Permit a payment that takes the invoice past its total. */
  allowOverpayment?: boolean;
}

export interface RecordPaymentResult {
  payment: Record<string, unknown>;
  totals: InvoiceTotals;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

/**
 * Append a payment and recompute the invoice summary atomically.
 *
 * Overpayment is rejected by default. A payment larger than the outstanding
 * balance is far more often a typo than an intent, and silently accepting it
 * corrupts revenue reporting; `allowOverpayment` exists for the genuine cases
 * (currency rounding on international transfers, deliberate credit on account).
 */
export async function recordInvoicePayment(
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  const amount = toCents(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError('Payment amount must be greater than zero', 400);
  }

  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select({
        id: invoices.id,
        status: invoices.status,
        totalAmount: invoices.totalAmount,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.tenantId, input.tenantId),
          sql`${invoices.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!invoice) throw new PaymentError('Invoice not found', 404);
    if (invoice.status === 'cancelled' || invoice.status === 'void') {
      throw new PaymentError(`Cannot record a payment against a ${invoice.status} invoice`, 409);
    }

    if (!input.allowOverpayment) {
      const [sum] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)` })
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.invoiceId, input.invoiceId),
            eq(invoicePayments.tenantId, input.tenantId),
            sql`${invoicePayments.deletedAt} IS NULL`
          )
        );
      const outstanding = toCents(money(invoice.totalAmount) - money(sum?.total));
      if (amount > outstanding) {
        throw new PaymentError(
          `Payment of ${amount.toFixed(2)} exceeds the outstanding balance of ${outstanding.toFixed(2)}. ` +
            'Pass allow_overpayment to record it anyway.',
          422
        );
      }
    }

    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        amount: amount.toFixed(2),
        paymentDate: input.paymentDate,
        paymentMethod: input.paymentMethod ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedBy: input.userId,
        createdBy: input.userId,
      })
      .returning();

    const totals = await recalculateInvoicePayments(tx, input.invoiceId, input.tenantId);
    return { payment: payment as Record<string, unknown>, totals };
  });
}

/**
 * Void a payment by soft-deleting it, then recompute the summary.
 *
 * Soft delete rather than hard: a payment that was recorded and reversed is
 * part of the financial history, and `audit_logs` alone cannot reconstruct the
 * amount and date. The ledger sum excludes soft-deleted rows.
 */
export async function voidInvoicePayment(opts: {
  invoiceId: string;
  paymentId: string;
  tenantId: string;
  userId: string;
}): Promise<InvoiceTotals> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select({ id: invoicePayments.id })
      .from(invoicePayments)
      .where(
        and(
          eq(invoicePayments.id, opts.paymentId),
          eq(invoicePayments.invoiceId, opts.invoiceId),
          eq(invoicePayments.tenantId, opts.tenantId),
          sql`${invoicePayments.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!payment) throw new PaymentError('Payment not found', 404);

    await tx
      .update(invoicePayments)
      .set({ deletedAt: new Date(), deletedBy: opts.userId, updatedAt: new Date() })
      .where(
        and(
          eq(invoicePayments.id, opts.paymentId),
          eq(invoicePayments.tenantId, opts.tenantId)
        )
      );

    return recalculateInvoicePayments(tx, opts.invoiceId, opts.tenantId);
  });
}

/** List the live payments for an invoice, newest first. */
export async function listInvoicePayments(invoiceId: string, tenantId: string) {
  return db
    .select()
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.invoiceId, invoiceId),
        eq(invoicePayments.tenantId, tenantId),
        sql`${invoicePayments.deletedAt} IS NULL`
      )
    )
    .orderBy(sql`${invoicePayments.paymentDate} DESC`);
}

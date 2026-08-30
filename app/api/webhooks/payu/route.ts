/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { isPayUConfigured, verifyPayUResponse } from '@/lib/payu';
import { db } from '@/drizzle/db';
import { quotes, invoices, invoicePayments } from '@/drizzle/schema';
import { recalculateInvoicePayments } from '@/lib/billing/payments';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * POST /api/webhooks/payu
 *
 * Handles PayU payment callback (success/failure).
 * PayU sends a POST with form data containing transaction details and hash.
 * This endpoint verifies the hash and records the payment outcome:
 *
 * - Success: appends an `invoice_payments` ledger entry for the invoice linked
 *   to the quoted order and recomputes the invoice summary (status -> 'paid',
 *   paid_at set on full settlement), then marks the quote accepted.
 * - Failure: records the failure on the quote's metadata.
 *
 * All writes happen inside a single transaction and are idempotent per txnid,
 * so PayU retries / duplicate callbacks never double-record a payment.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quote statuses that must never be auto-flipped to 'accepted'. */
const QUOTE_TERMINAL_STATUSES = new Set(['accepted', 'declined', 'expired', 'cancelled']);

interface ProcessResult {
  processed: boolean;
  alreadyProcessed?: boolean;
  reason?: string;
}

export async function POST(request: NextRequest) {
  try {
    if (!isPayUConfigured()) {
      return NextResponse.json({ error: 'PayU is not configured' }, { status: 503 });
    }

    const formData = await request.formData();

    const key = formData.get('key') as string | null;
    const txnid = formData.get('txnid') as string | null;
    const amount = formData.get('amount') as string | null;
    const productinfo = formData.get('productinfo') as string | null;
    const firstname = formData.get('firstname') as string | null;
    const email = formData.get('email') as string | null;
    const status = formData.get('status') as string | null;
    const hash = formData.get('hash') as string | null;
    const udf1 = (formData.get('udf1') as string) || '';
    const udf2 = (formData.get('udf2') as string) || '';
    const udf3 = (formData.get('udf3') as string) || '';
    const udf4 = (formData.get('udf4') as string) || '';
    const udf5 = (formData.get('udf5') as string) || '';
    const additionalCharges = (formData.get('additionalCharges') as string) || '';

    if (!key || !txnid || !amount || !productinfo || !firstname || !email || !status || !hash) {
      return NextResponse.json({ error: 'Missing required payment parameters' }, { status: 400 });
    }

    const isValid = verifyPayUResponse({
      key,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      status,
      hash,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      ...(additionalCharges ? { additionalCharges } : {}),
    });

    if (!isValid) {
      void logError({ error: 'PayU hash verification failed', context: 'webhooks/payu hash-verify', level: 'warning', metadata: { txnid } });
      return NextResponse.json({ error: 'Hash verification failed' }, { status: 400 });
    }

    // Extract quoteId from txnid format: NUCRM_{quoteId}_{random}
    const txnParts = txnid.split('_');
    const quoteId = txnParts.length >= 3 ? txnParts.slice(1, -1).join('_') : txnid;

    if (!UUID_RE.test(quoteId)) {
      void logError({ error: 'PayU could not derive a valid quote id from txnid', context: 'webhooks/payu txnid-parse', level: 'warning', metadata: { txnid } });
      return NextResponse.json({
        received: true,
        txnid,
        status,
        quoteId,
        processed: false,
        reason: 'unrecognized_txnid_format',
      });
    }

    let result: ProcessResult;
    try {
      result = await db.transaction(async (tx): Promise<ProcessResult> => {
        const now = new Date();

        const [quote] = await tx
          .select({
            id: quotes.id,
            tenantId: quotes.tenantId,
            status: quotes.status,
            metadata: quotes.metadata,
          })
          .from(quotes)
          .where(and(eq(quotes.id, quoteId), sql`${quotes.deletedAt} IS NULL`))
          .limit(1);

        if (!quote) {
          return { processed: false, reason: 'quote_not_found' };
        }

        // Latest live invoice raised from this quote. Row is locked FOR UPDATE
        // so two concurrent callbacks for the same invoice serialize here.
        const [invoice] = await tx
          .select({
            id: invoices.id,
            status: invoices.status,
            totalAmount: invoices.totalAmount,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, quote.tenantId),
              eq(invoices.quoteId, quote.id),
              sql`${invoices.deletedAt} IS NULL`
            )
          )
          .orderBy(desc(invoices.createdAt))
          .limit(1)
          .for('update');

        if (status === 'success') {
          const paidAmount = parseFloat(amount);
          if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
            void logError({ error: `PayU invalid amount '${amount}'`, context: 'webhooks/payu invalid-amount', level: 'warning', metadata: { txnid, amount } });
            return { processed: false, reason: 'invalid_amount' };
          }

          if (invoice) {
            if (invoice.status === 'cancelled' || invoice.status === 'void') {
              void logError({ error: `PayU refusing to record payment against ${invoice.status} invoice`, context: 'webhooks/payu invoice-not-payable', level: 'warning', metadata: { txnid, invoiceId: invoice.id, invoiceStatus: invoice.status } });
              return { processed: false, reason: `invoice_${invoice.status}` };
            }

            // Idempotency: skip if this txnid already recorded a payment, or
            // the invoice was already settled outside this callback.
            const [existing] = await tx
              .select({ id: invoicePayments.id })
              .from(invoicePayments)
              .where(
                and(
                  eq(invoicePayments.reference, txnid),
                  eq(invoicePayments.tenantId, quote.tenantId),
                  sql`${invoicePayments.deletedAt} IS NULL`
                )
              )
              .limit(1);

            if (existing || invoice.status === 'paid') {
              return { processed: false, alreadyProcessed: true };
            }

            // Append-only ledger entry; the invoice summary below is derived
            // from it (amount_paid / balance_due / status / paid_at).
            await tx.insert(invoicePayments).values({
              tenantId: quote.tenantId,
              invoiceId: invoice.id,
              amount: paidAmount.toFixed(2),
              paymentDate: now.toISOString().slice(0, 10),
              paymentMethod: 'payu',
              reference: txnid,
              notes: `PayU online payment (${email})`,
            });

            // Recomputes status ('paid' + paid_at when fully settled) inside
            // this same transaction so the summary cannot drift from the ledger.
            await recalculateInvoicePayments(tx, invoice.id, quote.tenantId);
          }

          // A paid quote is an accepted quote — unless it already reached a
          // terminal state (declined/expired/cancelled), which we never override.
          if (!QUOTE_TERMINAL_STATUSES.has(quote.status)) {
            await tx
              .update(quotes)
              .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
              .where(and(eq(quotes.id, quote.id), eq(quotes.tenantId, quote.tenantId)));
          }

          return { processed: true };
        }

        // ── Failure path ────────────────────────────────────────────────
        // No invoice mutation: a failed attempt leaves the invoice sent/
        // overdue as-is. Record the failure on the quote's metadata.
        const meta =
          quote.metadata && typeof quote.metadata === 'object'
            ? (quote.metadata as Record<string, unknown>)
            : {};
        const payuMeta =
          meta.payu && typeof meta.payu === 'object'
            ? (meta.payu as Record<string, unknown>)
            : {};
        const failures = Array.isArray(payuMeta.failures) ? payuMeta.failures : [];

        const alreadyRecorded = failures.some(
          (f) =>
            typeof f === 'object' &&
            f !== null &&
            (f as Record<string, unknown>).txnid === txnid
        );
        if (alreadyRecorded) {
          return { processed: false, alreadyProcessed: true };
        }

        await tx
          .update(quotes)
          .set({
            metadata: {
              ...meta,
              payu: {
                ...payuMeta,
                lastStatus: 'failed',
                lastFailedTxnId: txnid,
                lastFailedAt: now.toISOString(),
                failures: [...failures, { txnid, amount, at: now.toISOString() }].slice(-10),
              },
            },
            updatedAt: now,
          })
          .where(and(eq(quotes.id, quote.id), eq(quotes.tenantId, quote.tenantId)));

        return { processed: true };
      });
    } catch (dbErr: unknown) {
      void logError({ error: dbErr, context: 'webhooks/payu DB update', metadata: { txnid } });
      // Non-2xx makes PayU retry the callback later.
      throw dbErr;
    }

    console.log(`[PayU Webhook] Payment ${status} for quote: ${quoteId}, txnid: ${txnid}`, result);

    // Return success to PayU (acknowledge receipt)
    return NextResponse.json({
      received: true,
      txnid,
      status,
      quoteId,
      ...result,
    });
  } catch (err: unknown) {
    void logError({ error: err, context: 'webhooks/payu callback' });
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

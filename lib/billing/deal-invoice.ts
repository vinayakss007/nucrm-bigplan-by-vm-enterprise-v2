/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1817 — Auto-create a DRAFT invoice when a deal is won.
 *
 * Closes the sales→billing gap: winning a deal previously produced no billing
 * object even though `invoices.dealId` exists for revenue attribution. This
 * helper creates a draft invoice from the won deal, linked via `dealId`.
 *
 * Design guarantees:
 *  - OPT-IN: only runs when the tenant has `settings.autoInvoiceOnWon === true`
 *    (absent/false ⇒ off, so existing tenants are unaffected).
 *  - IDEMPOTENT: never creates a second invoice for the same deal (guarded by a
 *    pre-check on `invoices.dealId` and re-checked inside the tenant-locked
 *    transaction to be safe under concurrency).
 *  - NON-FATAL: all failures are swallowed/logged by the caller so a billing
 *    hiccup never breaks the deal-won flow.
 *  - RICHER SOURCE: if the deal has an accepted quote, its line items + totals
 *    are copied; otherwise a single amount-only draft is created from
 *    `deal.amount`.
 */
import { db } from '@/drizzle/db';
import {
  invoices,
  invoiceLineItems,
  quotes,
  quoteLineItems,
  activities,
  tenants,
} from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';

const MAX_RETRIES = 3;

interface WonDealRow {
  title?: string | null;
  amount?: string | null;
  contactId?: string | null;
  companyId?: string | null;
}

/**
 * Returns true when the tenant has opted in to auto-invoicing won deals.
 */
async function isAutoInvoiceEnabled(tenantId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const settings = (row?.settings as { autoInvoiceOnWon?: boolean } | null) ?? null;
    return settings?.autoInvoiceOnWon === true;
  } catch (err) {
    await logError({ error: err, context: 'deal-invoice: settings lookup' });
    return false;
  }
}

/**
 * Create a draft invoice for a won deal. Safe to call unconditionally on
 * deal-won: it self-gates on the tenant opt-in and on idempotency.
 *
 * @returns the created invoice id, or null when nothing was created (opt-out,
 *          already invoiced, or a handled error).
 */
export async function createInvoiceFromWonDeal(
  ctx: { tenantId: string; userId: string },
  dealId: string,
  row: WonDealRow,
): Promise<string | null> {
  try {
    // 1. Opt-in gate (default OFF).
    if (!(await isAutoInvoiceEnabled(ctx.tenantId))) return null;

    // 2. Idempotency: skip if this deal already has an invoice.
    const existing = await db.query.invoices.findFirst({
      where: and(eq(invoices.dealId, dealId), isNull(invoices.deletedAt)),
    });
    if (existing) return null;

    // 3. Prefer an accepted quote on this deal as the richer source.
    const acceptedQuote = await db.query.quotes.findFirst({
      where: and(
        eq(quotes.dealId, dealId),
        eq(quotes.tenantId, ctx.tenantId),
        eq(quotes.status, 'accepted'),
        isNull(quotes.deletedAt),
      ),
    });

    const quoteItems = acceptedQuote
      ? await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, acceptedQuote.id))
      : [];

    // Totals: from the accepted quote if present, else the deal amount.
    const subtotal = acceptedQuote?.subtotal ?? row.amount ?? '0';
    const discountAmount = acceptedQuote?.discount ?? '0';
    const taxAmount = acceptedQuote?.tax ?? '0';
    const totalAmount = acceptedQuote?.totalAmount ?? row.amount ?? '0';

    let createdInvoiceId: string | null = null;
    let createdInvoiceNumber = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await db.transaction(async (tx) => {
          // Re-check idempotency inside the tenant lock to close the race.
          await tx.execute(sql`SELECT id FROM tenants WHERE id = ${ctx.tenantId} FOR UPDATE`);

          const alreadyInvoiced = await tx.query.invoices.findFirst({
            where: and(eq(invoices.dealId, dealId), isNull(invoices.deletedAt)),
          });
          if (alreadyInvoiced) return null;

          // Race-safe INV-##### generation (mirrors convert-to-invoice).
          const [maxRow] = await tx
            .select({
              maxNum: sql<number>`COALESCE(MAX(
                CASE WHEN ${invoices.invoiceNumber} ~ '^INV-[0-9]+$'
                THEN CAST(SUBSTRING(${invoices.invoiceNumber} FROM 5) AS integer)
                ELSE 0 END
              ), 0)`,
            })
            .from(invoices)
            .where(eq(invoices.tenantId, ctx.tenantId));

          const seq = ((maxRow?.maxNum as number) ?? 0) + 1;
          const invoiceNumber = `INV-${String(seq).padStart(5, '0')}`;

          const [inv] = await tx
            .insert(invoices)
            .values([
              {
                tenantId: ctx.tenantId,
                createdBy: ctx.userId,
                contactId: row.contactId ?? undefined,
                companyId: row.companyId ?? undefined,
                dealId,
                quoteId: acceptedQuote?.id ?? undefined,
                invoiceNumber,
                title: row.title ?? `Invoice for deal`,
                status: 'draft',
                issueDate: new Date().toISOString().slice(0, 10),
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                subtotal,
                discountType: 'fixed',
                discountValue: discountAmount,
                discountAmount,
                taxRate: '0',
                taxAmount,
                totalAmount,
                amountPaid: '0',
                balanceDue: totalAmount,
              },
            ])
            .returning();

          if (!inv) throw new Error('Failed to create invoice');

          // Copy accepted-quote line items when available.
          if (quoteItems.length > 0) {
            await tx.insert(invoiceLineItems).values(
              quoteItems.map((item, idx) => ({
                tenantId: ctx.tenantId,
                invoiceId: inv.id,
                productId: item.productId ?? undefined,
                serviceId: item.serviceId ?? undefined,
                description: item.description ?? '',
                itemType: item.itemType ?? (item.serviceId ? 'service' : 'product'),
                quantity: item.quantity ?? '1',
                unitPrice: item.unitPrice ?? '0',
                discountType: 'percentage' as const,
                discountValue: item.discountPercent ?? '0',
                discountAmount: '0',
                taxRate: item.taxPercent ?? '0',
                taxAmount: '0',
                total: item.total ?? '0',
                sortOrder: idx,
              })),
            );
          }

          // Log an activity on the deal timeline.
          try {
            await tx.insert(activities).values({
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              entityType: 'deal',
              entityId: dealId,
              contactId: row.contactId ?? null,
              dealId,
              eventType: 'invoice_created',
              description: `Draft invoice ${invoiceNumber} created for won deal "${row.title ?? ''}"`,
              metadata: { deal_id: dealId, invoice_id: inv.id, invoice_number: invoiceNumber },
            });
          } catch (err) {
            // Activity is non-critical.
            await logError({ error: err, context: 'deal-invoice: activity insert' });
          }

          return { id: inv.id, invoiceNumber };
        });

        if (!result) return null; // idempotent skip inside tx
        createdInvoiceId = result.id;
        createdInvoiceNumber = result.invoiceNumber;
        break; // success
      } catch (err: unknown) {
        const isUniqueViolation =
          err instanceof Error &&
          ((err as { code?: string }).code === '23505' || err.message.includes('unique'));
        if (isUniqueViolation && attempt < MAX_RETRIES - 1) continue;
        throw err;
      }
    }

    if (createdInvoiceId) {
      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'deal_won_invoice_created',
        entityType: 'deal',
        entityId: dealId,
        newData: { invoice_id: createdInvoiceId, invoice_number: createdInvoiceNumber },
      }).catch((err) => logError({ error: err, context: 'deal-invoice: audit' }));
    }

    return createdInvoiceId;
  } catch (err) {
    // Never break the deal-won flow because of a billing failure.
    await logError({ error: err, context: 'deal-invoice: createInvoiceFromWonDeal' });
    return null;
  }
}

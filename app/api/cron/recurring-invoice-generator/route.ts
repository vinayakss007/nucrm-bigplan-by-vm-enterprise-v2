/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Recurring Invoice Generator — runs daily (#1631)
 *
 * Finds active recurring invoices whose `nextBillingDate` is due (<= today) and
 * spawns the next invoice in the series:
 *   - clones the source invoice's header (amounts, tax, discount, currency,
 *     contact/company/deal links, notes, terms)
 *   - clones its line items verbatim
 *   - generates a fresh, gap-free invoice number using the same per-tenant
 *     `FOR UPDATE` + MAX(sequence) scheme as the manual create route (#1462)
 *   - links the new invoice to the series via `parentInvoiceId` (points at the
 *     series ROOT so the whole series is discoverable from one id)
 *   - advances the source invoice's `nextBillingDate` by its frequency
 *
 * Idempotency: a distributed lock guards against overlapping runs, and the
 * advance of `nextBillingDate` in the SAME transaction that inserts the new
 * invoice means a due invoice is picked up exactly once per period — a re-run
 * on the same day no longer sees it as due.
 *
 * The spawned invoice is `isRecurring = false` (it is a concrete issued
 * invoice, not itself a template); the source row remains the recurring
 * template and keeps advancing.
 */
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { invoices, invoiceLineItems } from '@/drizzle/schema';
import { eq, and, isNull, lte, ne, sql, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';

const MAX_NUMBER_RETRIES = 3;

/**
 * Advance a yyyy-mm-dd date string by one recurring period. Unknown or missing
 * frequencies fall back to monthly (the most common billing cadence) so a
 * misconfigured row still advances rather than regenerating every day.
 */
function advanceDate(fromISO: string, frequency: string | null): string {
  const d = new Date(`${fromISO}T00:00:00Z`);
  switch ((frequency || 'monthly').toLowerCase()) {
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'biweekly':
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'semiannual':
    case 'semi-annual':
    case 'biannual':
      d.setUTCMonth(d.getUTCMonth() + 6);
      break;
    case 'yearly':
    case 'annual':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    case 'monthly':
    default:
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
  }
  return d.toISOString().split('T')[0]!;
}

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard: skip when another scheduler instance already fired
  // this job within its interval.
  const lock = await acquireLock('cron:recurring-invoice-generator', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0]!;

    // Templates due for generation: recurring, active (not cancelled), not
    // soft-deleted, with a due next-billing date on or before today.
    const dueTemplates = await db
      .select()
      .from(invoices)
      .where(and(
        eq(invoices.isRecurring, true),
        isNull(invoices.deletedAt),
        ne(invoices.status, 'cancelled'),
        sql`${invoices.nextBillingDate} IS NOT NULL`,
        lte(invoices.nextBillingDate, todayStr),
      ));

    let generated = 0;
    const errors: Array<{ invoiceId: string; error: string }> = [];

    // Batch: line items for ALL due templates in one query (was one fetch
    // per template). Per-template transactions below stay serial per tenant
    // for invoice-number correctness (#1462) — only the reads are batched.
    const templateIds = dueTemplates.map(t => t.id);
    const allItems = templateIds.length > 0 ? await db
      .select()
      .from(invoiceLineItems)
      .where(inArray(invoiceLineItems.invoiceId, templateIds))
      .orderBy(invoiceLineItems.sortOrder) : [];
    const itemsByTemplate = new Map<string, typeof allItems>();
    for (const it of allItems) {
      const list = itemsByTemplate.get(it.invoiceId);
      if (list) list.push(it);
      else itemsByTemplate.set(it.invoiceId, [it]);
    }

    for (const template of dueTemplates) {
      try {
        const tenantId = template.tenantId;

        // Line items to clone for this template (prefetched above).
        const items = itemsByTemplate.get(template.id) ?? [];

        // The series root: point every child at the top of the series so the
        // whole chain is reachable from one id. If the template is itself a
        // child, reuse its parent; otherwise the template IS the root.
        const seriesRootId = template.parentInvoiceId ?? template.id;

        // Derive the new dates from the period being billed.
        const issueDate = todayStr;
        // Preserve the original issue->due gap (in days) if both existed;
        // otherwise leave due date null.
        let dueDate: string | null = null;
        if (template.dueDate && template.issueDate) {
          const gapMs =
            new Date(`${template.dueDate}T00:00:00Z`).getTime() -
            new Date(`${template.issueDate}T00:00:00Z`).getTime();
          const gapDays = Math.max(0, Math.round(gapMs / 86_400_000));
          const due = new Date(`${issueDate}T00:00:00Z`);
          due.setUTCDate(due.getUTCDate() + gapDays);
          dueDate = due.toISOString().split('T')[0]!;
        }

        for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
          try {
            await db.transaction(async (tx) => {
              // Serialize invoice-number generation for this tenant (#1462).
              await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

              const [maxRow] = await tx
                .select({
                  maxNum: sql<number>`COALESCE(MAX(
                    CASE WHEN ${invoices.invoiceNumber} ~ '^INV-[0-9]+$'
                    THEN CAST(SUBSTRING(${invoices.invoiceNumber} FROM 5) AS integer)
                    ELSE 0 END
                  ), 0)`,
                })
                .from(invoices)
                .where(eq(invoices.tenantId, tenantId));

              const seq = ((maxRow?.maxNum as number) ?? 0) + 1;
              const invoiceNumber = `INV-${String(seq).padStart(5, '0')}`;

              const [child] = await tx
                .insert(invoices)
                .values({
                  tenantId,
                  contactId: template.contactId,
                  companyId: template.companyId,
                  dealId: template.dealId,
                  invoiceNumber,
                  title: template.title,
                  status: 'draft',
                  issueDate,
                  dueDate,
                  subtotal: template.subtotal,
                  discountType: template.discountType,
                  discountValue: template.discountValue,
                  discountAmount: template.discountAmount,
                  taxAmount: template.taxAmount,
                  taxRate: template.taxRate,
                  totalAmount: template.totalAmount,
                  amountPaid: '0',
                  balanceDue: template.totalAmount,
                  currency: template.currency,
                  notes: template.notes,
                  terms: template.terms,
                  footer: template.footer,
                  // The spawned invoice is a concrete issued invoice, not a
                  // template — it does not itself recur.
                  isRecurring: false,
                  parentInvoiceId: seriesRootId,
                  createdBy: template.createdBy,
                  metadata: {
                    generated_by: 'recurring-invoice-generator',
                    source_invoice_id: template.id,
                    billing_period: todayStr,
                  },
                } as typeof invoices.$inferInsert)
                .returning();

              if (!child) throw new Error('Failed to create recurring invoice');

              if (items.length) {
                await tx.insert(invoiceLineItems).values(
                  items.map((it) => ({
                    tenantId,
                    invoiceId: child.id,
                    productId: it.productId,
                    serviceId: it.serviceId,
                    description: it.description,
                    itemType: it.itemType,
                    quantity: it.quantity,
                    unitPrice: it.unitPrice,
                    discountType: it.discountType,
                    discountValue: it.discountValue,
                    discountAmount: it.discountAmount,
                    taxRate: it.taxRate,
                    taxAmount: it.taxAmount,
                    total: it.total,
                    sortOrder: it.sortOrder,
                  })) as (typeof invoiceLineItems.$inferInsert)[],
                );
              }

              // Advance the template's schedule IN THE SAME TRANSACTION so the
              // generation + schedule bump commit atomically — a same-day re-run
              // won't see this template as due again.
              const nextDate = advanceDate(
                template.nextBillingDate ?? todayStr,
                template.recurringFrequency,
              );
              await tx
                .update(invoices)
                .set({ nextBillingDate: nextDate, updatedAt: new Date() })
                .where(and(eq(invoices.id, template.id), eq(invoices.tenantId, tenantId)));
            });
            break; // success
          } catch (err: unknown) {
            const isUniqueViolation =
              err instanceof Error &&
              ((err as { code?: string }).code === '23505' || err.message.includes('unique'));
            if (isUniqueViolation && attempt < MAX_NUMBER_RETRIES - 1) continue;
            throw err;
          }
        }

        generated++;
      } catch (err) {
        errors.push({
          invoiceId: template.id,
          error: err instanceof Error ? err.message : String(err),
        });
        await logError({
          error: err,
          context: 'cron/recurring-invoice-generator: failed for one template',
          tenantId: template.tenantId,
          metadata: { sourceInvoiceId: template.id },
        });
      }
    }

    logger.info('[cron/recurring-invoice-generator] run complete', {
      due: dueTemplates.length,
      generated,
      failed: errors.length,
    });

    return NextResponse.json({
      ok: true,
      due: dueTemplates.length,
      generated,
      failed: errors.length,
      errors,
    });
  } catch (err) {
    void logError({ error: err, context: 'cron/recurring-invoice-generator' });
    return apiError(err);
  }
}

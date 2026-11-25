/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolvePortalContact, resolvePortalIdentity } from '@/lib/portal-auth';
import { NO_USER_SENTINEL, withTenantContext } from '@/lib/db/rls';
import { logError } from '@/lib/errors-server';
import { renderInvoicePdf } from '@/lib/pdf/render';
import { mapInvoiceToPdfData, type InvoiceRow, type LineItemRow } from '@/lib/pdf/mappers';
import { contacts, invoiceLineItems, invoices, tenants } from '@/drizzle/schema';

const VISIBLE_STATUSES = ['sent', 'paid', 'overdue', 'partially_paid'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-invoice-pdf', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const identity = await resolvePortalIdentity(request);
    if (!identity) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const invoiceId = (await params).id;
    const result = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return null;

      const [invoice] = await tx.select({
        contactId: invoices.contactId,
        invoiceNumber: invoices.invoiceNumber,
        title: invoices.title,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        discountAmount: invoices.discountAmount,
        taxAmount: invoices.taxAmount,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        balanceDue: invoices.balanceDue,
        notes: invoices.notes,
        terms: invoices.terms,
        footer: invoices.footer,
      })
        .from(invoices)
        .where(and(
          eq(invoices.id, invoiceId),
          eq(invoices.tenantId, contact.tenantId),
          eq(invoices.contactId, contact.id),
          isNull(invoices.deletedAt),
          inArray(invoices.status, VISIBLE_STATUSES),
        ))
        .limit(1);
      if (!invoice) return null;

      const items = await tx.select({
        description: invoiceLineItems.description,
        quantity: invoiceLineItems.quantity,
        unitPrice: invoiceLineItems.unitPrice,
        total: invoiceLineItems.total,
      })
        .from(invoiceLineItems)
        .where(and(
          eq(invoiceLineItems.invoiceId, invoiceId),
          isNull(invoiceLineItems.deletedAt),
        ))
        .orderBy(asc(invoiceLineItems.sortOrder));

      let contactName = '';
      if (invoice.contactId) {
        const [row] = await tx.select({ name: contacts.firstName })
          .from(contacts)
          .where(and(eq(contacts.id, invoice.contactId), isNull(contacts.deletedAt)))
          .limit(1);
        contactName = row?.name ?? '';
      }

      const [tenant] = await tx.select({ name: tenants.name })
        .from(tenants)
        .where(and(eq(tenants.id, contact.tenantId), isNull(tenants.deletedAt)))
        .limit(1);

      return { invoice, items, contactName, tenantName: tenant?.name };
    });

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const pdf = await renderInvoicePdf(mapInvoiceToPdfData(
      result.invoice as unknown as InvoiceRow,
      result.items as unknown as LineItemRow[],
      result.contactName,
      result.tenantName,
    ));
    const safeName = String(result.invoice.invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9_\-]/g, '_');
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      },
    });
  } catch (err) {
    await logError({ error: err, context: 'public/invoices/[id]/pdf GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Failed to generate invoice PDF' }, { status: 500 });
  }
}

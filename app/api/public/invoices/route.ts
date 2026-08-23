/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { invoices, contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-invoices', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const email = request.nextUrl.searchParams.get('email');
    if (!email) return NextResponse.json({ data: [] });

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
      columns: { id: true, tenantId: true }
    });

    if (!contact) return NextResponse.json({ data: [] });

    // Only return invoices that have been explicitly sent or paid (never draft/cancelled).
    // Only expose fields safe for public consumption — no internal notes, no payment
    // references, no created_by / updated_by identifiers.
    const data = await db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      totalAmount: invoices.totalAmount,
      amountPaid: invoices.amountPaid,
      balanceDue: invoices.balanceDue,
      currency: invoices.currency,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      paidAt: invoices.paidAt,
    })
      .from(invoices)
      .where(and(
        eq(invoices.tenantId, contact.tenantId),
        eq(invoices.contactId, contact.id),
        isNull(invoices.deletedAt),
        // Only show invoices that have been sent to the client
        inArray(invoices.status, ['sent', 'paid', 'overdue', 'partially_paid'])
      ))
      .orderBy(desc(invoices.createdAt))
      .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}

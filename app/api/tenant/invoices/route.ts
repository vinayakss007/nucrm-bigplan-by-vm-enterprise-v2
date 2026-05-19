import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { invoices, invoiceLineItems } from '@/drizzle/schema';
import { eq, and, desc, sql, like, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const whereConditions = [eq(invoices.tenantId, tenantId)];

    if (status) {
      whereConditions.push(eq(invoices.status, status));
    }

    if (contactId) {
      whereConditions.push(eq(invoices.contactId, contactId as any));
    }

    const offset = (page - 1) * limit;
    const results = await db.select().from(invoices).where(and(...whereConditions)).orderBy(desc(invoices.createdAt)).limit(limit).offset(offset);

    const [countResult] = await db.select({ count: count() }).from(invoices).where(eq(invoices.tenantId, tenantId));
    const total = countResult?.count ?? 0;

    return NextResponse.json({ 
      invoices: results, 
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('[invoices/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const body = await request.json();
    const { contactId, companyId, title, issueDate, dueDate, notes, terms, items, discountType, discountValue, taxRate } = body;

    if (!issueDate) {
      return NextResponse.json({ error: 'Issue date is required' }, { status: 400 });
    }

    // Generate invoice number
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(eq(invoices.tenantId, tenantId));
    const invoiceNumber = `INV-${String((countResult[0]?.count ?? 0) + 1).padStart(5, '0')}`;

    // Calculate totals
    let subtotal = 0;
    if (items?.length) {
      for (const item of items) {
        const qty = parseFloat(item.quantity) || 1;
        const price = parseFloat(item.unitPrice) || 0;
        subtotal += qty * price;
      }
    }

    const discountAmount = discountType === 'fixed' 
      ? parseFloat(discountValue) || 0 
      : (subtotal * (parseFloat(discountValue) || 0) / 100);
    
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = (parseFloat(taxRate) || 0) / 100 * taxableAmount;
    const totalAmount = taxableAmount + taxAmount;

    const [invoice] = await db.insert(invoices).values({
      tenantId,
      contactId: contactId ?? null,
      companyId: companyId ?? null,
      invoiceNumber,
      title: title ?? `Invoice ${invoiceNumber}`,
      status: 'draft',
      issueDate: new Date(issueDate).toISOString().split('T')[0],
      dueDate: dueDate ? new Date(dueDate).toISOString().split('T')[0] : null,
      subtotal: String(subtotal.toFixed(2)),
      discountType: discountType ?? 'percentage',
      discountValue: discountValue ? String(discountValue) : '0',
      discountAmount: String(discountAmount.toFixed(2)),
      taxRate: taxRate ? String(taxRate) : '0',
      taxAmount: String(taxAmount.toFixed(2)),
      totalAmount: String(totalAmount.toFixed(2)),
      amountPaid: '0',
      balanceDue: String(totalAmount.toFixed(2)),
      notes: notes ?? null,
      terms: terms ?? null,
      createdBy: userId,
    } as any).returning();

    if (!invoice) throw new Error('Failed to create invoice');

    // Add line items
    if (items?.length) {
      const lineItems = items.map((item: any, idx: number) => ({
        invoiceId: invoice.id,
        productId: item.productId || null,
        serviceId: item.serviceId || null,
        description: item.description,
        itemType: item.itemType || 'custom',
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unitPrice || 0),
        discountType: item.discountType || 'percentage',
        discountValue: item.discountValue ? String(item.discountValue) : '0',
        discountAmount: '0',
        taxRate: item.taxRate ? String(item.taxRate) : '0',
        taxAmount: '0',
        total: String(((parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0)).toFixed(2)),
        sortOrder: idx,
      }));

      await db.insert(invoiceLineItems).values(lineItems);
    }

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    console.error('[invoices/POST]', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
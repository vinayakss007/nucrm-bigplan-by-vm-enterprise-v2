import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createContractSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { contracts } from '@/drizzle/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const filters = [eq(contracts.tenantId, tenantId)];
    if (status) {
      filters.push(eq(contracts.status, status));
    }

    const offset = (page - 1) * limit;
    const results = await db.select().from(contracts).where(and(...filters)).orderBy(desc(contracts.startDate)).limit(limit).offset(offset);
    const countResult = await db.select({ count: count() }).from(contracts).where(eq(contracts.tenantId, tenantId));
    const total = countResult[0]?.count ?? 0;

    return NextResponse.json({ contracts: results, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('[contracts/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createContractSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: companyId, title, type: contractType, start_date: startDate, end_date: endDate, value: totalValue, description, terms, status } = v;

    if (!title || !startDate) {
      return NextResponse.json({ error: 'Title and start date are required' }, { status: 400 });
    }

    const [contract] = await db.insert(contracts).values({
      tenantId,
      contactId: contactId || null,
      companyId: companyId || null,
      title,
      contractNumber: null,
      contractType: contractType || 'other',
      status: status ?? 'draft',
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      totalValue: totalValue ? String(totalValue) : null,
      billingFrequency: null,
      terms,
      notes: description,
      documentUrl: null,
      createdBy: userId,
    } as any).returning();

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    console.error('[contracts/POST]', error);
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 });
  }
}
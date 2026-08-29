/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createContractSchema } from '@/lib/api/schemas';
import { parsePageLimit } from '@/lib/api/query-params';
import { db } from '@/drizzle/db';
import { contracts } from '@/drizzle/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const _contactId = searchParams.get('contactId');
    const { page, limit, offset } = parsePageLimit(searchParams);

    const filters = [eq(contracts.tenantId, tenantId)];
    if (status) {
      filters.push(eq(contracts.status, status));
    }

    const results = await db.select().from(contracts).where(and(...filters)).orderBy(desc(contracts.startDate)).limit(limit).offset(offset);
    const countResult = await db.select({ count: count() }).from(contracts).where(eq(contracts.tenantId, tenantId));
    const total = countResult[0]?.count ?? 0;

    return NextResponse.json({ contracts: results, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    await logError({ error, context: 'tenant/contracts GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'contracts', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await readJsonBody(request);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returning();

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    await logError({ error, context: 'tenant/contracts POST', requestMethod: 'POST' });
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 });
  }
});
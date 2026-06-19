import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createSubscriptionSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { serviceSubscriptions } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const _contactId = searchParams.get('contactId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [eq(serviceSubscriptions.tenantId, tenantId)];
    if (status) conditions.push(eq(serviceSubscriptions.status, status));

    const offset = (page - 1) * limit;
    const results = await db.select().from(serviceSubscriptions).where(and(...conditions)).orderBy(desc(serviceSubscriptions.startDate)).limit(limit).offset(offset);
    const totalRes = await db.select({ count: sql<number>`count(*)::int` }).from(serviceSubscriptions).where(eq(serviceSubscriptions.tenantId, tenantId));
    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({ subscriptions: results, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('[subscriptions/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createSubscriptionSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: companyId, status, start_date: startDate, end_date: endDate, trial_end_date: trialEndDate, billing_frequency: billingFrequency, auto_renew: autoRenew, quantity: _quantity } = v;

    if (!startDate || !billingFrequency) {
      return NextResponse.json({ error: 'Start date and billing frequency are required' }, { status: 400 });
    }

    const [subscription] = await db.insert(serviceSubscriptions).values({
      tenantId,
      contactId: contactId || null,
      companyId: companyId || null,
      name: 'Subscription',
      planName: null,
      status: status ?? 'active',
      startDate: new Date(startDate),
      currentPeriodStart: new Date(startDate),
      currentPeriodEnd: endDate ? new Date(endDate) : null,
      amount: '0',
      currency: 'USD',
      billingFrequency,
      autoRenew: autoRenew ?? true,
      paymentMethod: null,
      last4: null,
      trialEndDate: trialEndDate ? new Date(trialEndDate) : null,
      createdBy: userId,
    } as any).returning();

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    console.error('[subscriptions/POST]', error);
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 });
  }
}
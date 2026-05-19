import { NextRequest, NextResponse } from 'next/server';
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { scheduledReports } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantCtx();
    if (ctx instanceof NextResponse) return ctx;

    const reports = await db.select().from(scheduledReports)
      .where(eq(scheduledReports.tenantId, ctx.tenantId))
      .orderBy(desc(scheduledReports.createdAt));

    return NextResponse.json({ data: reports });
  } catch (error) {
    console.error('[scheduled-reports/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenantCtx();
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const { name, type, frequency, recipients, config } = body;

    if (!name || !type || !frequency) {
      return NextResponse.json({ error: 'Name, type, and frequency are required' }, { status: 400 });
    }

    const [report] = await db.insert(scheduledReports).values({
      id: uuid(),
      tenantId: ctx.tenantId,
      name,
      type,
      frequency,
      recipients: recipients || [],
      config: config || {},
      lastRunAt: null,
      nextRunAt: calculateNextRun(frequency),
      status: 'active',
      createdBy: ctx.userId,
    }).returning();

    return NextResponse.json({ data: report }, { status: 201 });
  } catch (error) {
    console.error('[scheduled-reports/POST]', error);
    return NextResponse.json({ error: 'Failed to create report' }, { status: 500 });
  }
}

function calculateNextRun(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case 'hourly':
      return new Date(now.getTime() + 60 * 60 * 1000);
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

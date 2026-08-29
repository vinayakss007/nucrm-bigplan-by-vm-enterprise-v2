/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines, contacts, companies } from '@/drizzle/schema';
import { eq, asc } from 'drizzle-orm';
import { escapeCSV } from '@/lib/export';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'deals.export');
    if (deny) return deny;

    const rows = await db
      .select({
        title: deals.title,
        amount: deals.amount,
        closeDate: deals.closeDate,
        pipelineName: pipelines.name,
        stageName: dealStages.name,
        contactEmail: contacts.email,
        companyName: companies.name,
        assignedTo: deals.assignedTo,
        createdAt: deals.createdAt,
      })
      .from(deals)
      .leftJoin(pipelines, eq(deals.pipelineId, pipelines.id))
      .leftJoin(dealStages, eq(deals.stageId, dealStages.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .leftJoin(companies, eq(deals.companyId, companies.id))
      .where(eq(deals.tenantId, ctx.tenantId))
      .orderBy(asc(deals.createdAt));

    const headers = ['title', 'amount', 'close_date', 'pipeline', 'stage', 'contact_email', 'company', 'assigned_to', 'created_at'];
    const csvRows = rows.map(r => [
      escapeCSV(r.title),
      escapeCSV(r.amount),
      escapeCSV(r.closeDate),
      escapeCSV(r.pipelineName),
      escapeCSV(r.stageName),
      escapeCSV(r.contactEmail),
      escapeCSV(r.companyName),
      escapeCSV(r.assignedTo),
      escapeCSV(r.createdAt),
    ].join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="deals-export.csv"`,
      },
    });
  } catch (err: unknown) {
    await logError({ error: err, context: 'tenant/deals export GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
});

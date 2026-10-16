/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines, contacts, companies } from '@/drizzle/schema';
import { eq, asc, and, isNull } from 'drizzle-orm';
import { escapeCSV } from '@/lib/export';
import { notArchived } from '@/lib/api/deals-archive-filter';
import { ownerScope } from '@/lib/api/owner-scope';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { enforceFieldRead } from '@/lib/rbac/enforce';

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
      // #2291: tombstoned deals must not leak into the CSV export — the
      // generic /api/tenant/export handler already filters deletedAt for deals.
      // #2677 adds the two predicates this list-shaped read was still missing:
      // archived deals (`deals/route.ts:53` hides them by default) and, for a
      // caller without `deals.view_all`, everything not assigned to or created
      // by them (`deals/route.ts:56-58`, `deals/[id]` 404s the same rows).
      .where(and(
        eq(deals.tenantId, ctx.tenantId),
        isNull(deals.deletedAt),
        notArchived(),
        ownerScope(ctx, 'deals.view_all', deals),
      ))
      .orderBy(asc(deals.createdAt));

    // #2614 — field_permissions were being bypassed on the CSV export path:
    // the export handler selected `amount` (and every other restricted column)
    // unconditionally, so a role with `amount` hidden via the admin UI still
    // saw every deal's full value in the download. Project rows through
    // enforceFieldRead and drop any column the role cannot see.
    const projected = await enforceFieldRead(ctx, 'deals', rows);
    const CANON: { header: string; key: keyof (typeof rows)[number] }[] = [
      { header: 'title', key: 'title' },
      { header: 'amount', key: 'amount' },
      { header: 'close_date', key: 'closeDate' },
      { header: 'pipeline', key: 'pipelineName' },
      { header: 'stage', key: 'stageName' },
      { header: 'contact_email', key: 'contactEmail' },
      { header: 'company', key: 'companyName' },
      { header: 'assigned_to', key: 'assignedTo' },
      { header: 'created_at', key: 'createdAt' },
    ];
    // A role with no rows in field_permissions returns `projected === rows`,
    // so this filter keeps all nine columns for unrestricted callers.
    const sample = projected[0] ?? {};
    const active = CANON.filter((c) => c.key in sample);
    const headers = active.map((c) => c.header);
    const csvRows = projected.map((r) =>
      active.map((c) => escapeCSV(r[c.key] as never)).join(','),
    );

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

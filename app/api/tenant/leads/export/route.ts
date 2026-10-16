/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/tenant/leads/export — the leads list as CSV.
 *
 * #2678: this route did not exist. The leads page fetched
 * `/api/tenant/contacts/export`, renamed the download `leads_<date>.csv` and
 * toasted "Exported N leads", so the file was the tenant's contact book — with
 * both query params discarded (`lead_status` is not a key the contacts branch
 * reads, and `q` matched contact names). Leads have their own table
 * (`drizzle/schema/crm.ts:170`), so the button was never a rename away from
 * being correct.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { generateExportData, ExportLimitError } from '@/lib/export';
import { ownerScope } from '@/lib/api/owner-scope';
import { leads } from '@/drizzle/schema';
import { enforceFieldRead } from '@/lib/rbac/enforce';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'leads.export');
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || undefined;
    const leadStatus = searchParams.get('lead_status') || undefined;

    const csv = await generateExportData({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: 'leads',
      // The leads list narrows to the caller's own rows without
      // leads.view_all (app/api/tenant/leads/route.ts:89-91); the download has to
      // answer with the same set or it becomes the way around that (#2677).
      filters: { q, lead_status: leadStatus },
      scope: ownerScope(ctx, 'leads.view_all', leads),
      // Same doctrine as the contacts (#2618) and deals (#2614) exports: the CSV
      // must not bypass field_permissions.
      project: (data) => enforceFieldRead(ctx, 'leads', data),
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    // An over-limit export is client-actionable, not a server fault — 413, and
    // don't page on-call for it (#H2, as in the contacts export).
    if (err instanceof ExportLimitError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    await logError({ error: err, context: 'tenant/leads export GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

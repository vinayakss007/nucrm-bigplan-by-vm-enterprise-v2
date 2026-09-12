/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { generateExportData, ExportLimitError } from '@/lib/export';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.export' as string);
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || undefined;

    const csv = await generateExportData({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: 'contacts',
      filters: { q }
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // #H2: an over-limit export is a client-actionable condition, not a server
    // fault — return 413 and tell the user to narrow the filter, and don't page
    // on-call for it.
    if (err instanceof ExportLimitError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    await logError({ error: err, context: 'tenant/contacts export GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

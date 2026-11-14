/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { rateLimitRead } from '@/lib/api/read-rate-limit';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitRead(request, 'analytics');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'reports.view');
    if (deny) return deny;
    return NextResponse.json({
      data: {
        totalContacts: 0,
        totalLeads: 0,
        totalDeals: 0,
      },
    });
  } catch (err) {
    void logError({ error: err, context: 'analytics/stats GET' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
});

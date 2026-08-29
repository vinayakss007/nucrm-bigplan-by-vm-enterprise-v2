/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
/**
 * Super Admin Announcements API
 * GET /api/super-admin/announcements - List platform announcements
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Super Admin access required' }, { status: 403 });
    }

    return NextResponse.json({ data: [], total: 0 });
  } catch (err) {
    void logError({ error: err, context: 'super-admin/announcements GET' });
    return apiError(err);
  }
});

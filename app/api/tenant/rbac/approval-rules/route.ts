/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * #2597: /api/tenant/rbac/approval-rules returns 200 with [] rather than 404,
 * so the empty state in /tenant/settings/rbac means what it says ("No approval
 * rules configured yet") instead of reporting an unhandled 404 read failure.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    return NextResponse.json({ data: [] });
  } catch (err: unknown) {
    return apiError(err);
  }
});

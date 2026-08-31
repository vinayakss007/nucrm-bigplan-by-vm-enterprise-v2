/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { rateLimitRead } from '@/lib/api/read-rate-limit';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitRead(request, 'analytics');
    if (limited) return limited;
    await requireAuth(request);
    return NextResponse.json({ data: {} });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
});

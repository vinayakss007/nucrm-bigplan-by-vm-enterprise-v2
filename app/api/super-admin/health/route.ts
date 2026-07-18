import { apiError } from '@/lib/api-error';
/**
 * Super Admin Health API
 * GET /api/super-admin/health - Get platform health status
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Super Admin access required' }, { status: 403 });
    }

    return NextResponse.json({ data: [], total: 0 });
  } catch (err) {
    console.error('[super-admin health GET]', err);
    return apiError(err);
  }
}

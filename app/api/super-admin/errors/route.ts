import { apiError } from '@/lib/api-error';
/**
 * Super Admin Errors API
 * GET /api/super-admin/errors - List platform errors
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
    console.error('[super-admin errors GET]', err);
    return apiError(err);
  }
}

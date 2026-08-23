/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { syncCalendarEvents } from '@/lib/calendar-sync/service';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'calendarSync', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'calendar.manage');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { provider: providerType, from, to } = body;

    if (!['google', 'outlook'].includes(providerType)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const result = await syncCalendarEvents(ctx.tenantId, ctx.userId, providerType, fromDate, toDate);

    return NextResponse.json({ ok: true, result });
  } catch (err: unknown) {
    console.error('[calendar-sync POST]', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

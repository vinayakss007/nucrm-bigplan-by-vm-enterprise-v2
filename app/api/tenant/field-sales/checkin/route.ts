/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { logError } from '@/lib/errors-server';
import { z } from 'zod';
import {
  createCheckIn,
  getUserCheckIns,
} from '@/lib/field-sales/geo-checkin';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const createCheckInSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  photoUrl: z.string().url().optional(),
  voiceNoteUrl: z.string().url().optional(),
  address: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/tenant/field-sales/checkin
 * Create a new geo check-in for the authenticated user.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await rateLimitMutating(request, 'fieldSales', 'post');
    if (limited) return limited;

    const raw = await readJsonBody(request);
    const parsed = validateBody(createCheckInSchema, raw);
    if (parsed instanceof NextResponse) return parsed;

    const checkIn = createCheckIn(ctx.userId, ctx.tenantId, parsed.data);

    return NextResponse.json({ data: checkIn }, { status: 201 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'field-sales/checkin POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

/**
 * GET /api/tenant/field-sales/checkin
 * List check-ins for the authenticated user with optional date filter.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // Default to today if no range provided
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const from = fromParam ? new Date(fromParam) : startOfDay;
    const to = toParam ? new Date(toParam) : endOfDay;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format for from/to parameters' },
        { status: 400 }
      );
    }

    const checkIns = getUserCheckIns(ctx.userId, ctx.tenantId, { from, to });

    return NextResponse.json({
      data: checkIns,
      total: checkIns.length,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'field-sales/checkin GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

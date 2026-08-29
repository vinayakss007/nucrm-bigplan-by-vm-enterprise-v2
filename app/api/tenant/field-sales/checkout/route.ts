/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { z } from 'zod';
import { createCheckOut, getCheckInById } from '@/lib/field-sales/geo-checkin';
import { withApiRoute } from '@/lib/api/with-api-route';

const createCheckOutSchema = z.object({
  checkInId: z.string().min(1, 'checkInId is required'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/tenant/field-sales/checkout
 * Create a check-out for an active check-in.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const raw = await readJsonBody(request);
    const parsed = validateBody(createCheckOutSchema, raw);
    if (parsed instanceof NextResponse) return parsed;

    const { checkInId, lat, lng, notes } = parsed.data;

    // Verify the check-in exists and belongs to this user
    const existing = getCheckInById(checkInId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }
    if (existing.userId !== ctx.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: check-in belongs to another user' },
        { status: 403 }
      );
    }
    if (existing.checkedOutAt) {
      return NextResponse.json(
        { error: 'Already checked out' },
        { status: 409 }
      );
    }

    const checkOut = createCheckOut(checkInId, ctx.userId, { lat, lng, notes });

    return NextResponse.json({ data: checkOut }, { status: 200 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[field-sales/checkout POST]', err);
    return apiError(err);
  }
});

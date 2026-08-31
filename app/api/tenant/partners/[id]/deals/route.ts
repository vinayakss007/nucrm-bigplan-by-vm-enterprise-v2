/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import {
  registerDeal,
  getPartnerDealRegistrations,
  getPartnerById,
  checkConflict,
} from '@/lib/partners';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

/**
 * GET /api/tenant/partners/[id]/deals
 * List deal registrations for a partner.
 */
export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const partnerId = (await params).id;

    const partner = getPartnerById(partnerId, ctx.tenantId);
    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    }

    const registrations = getPartnerDealRegistrations(partnerId, ctx.tenantId);
    return NextResponse.json({ data: registrations, total: registrations.length });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant partner deals GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

/**
 * POST /api/tenant/partners/[id]/deals
 * Register a new deal for a partner.
 */
export const POST = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> },) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await rateLimitMutating(request, 'partners', 'post');
    if (limited) return limited;

    const partnerId = (await params).id;
    const body = await request.json();
    const { dealTitle, contactName, contactEmail, expectedValue, expiresAt } = body;

    if (!dealTitle || !contactName || !contactEmail) {
      return NextResponse.json(
        { error: 'dealTitle, contactName, and contactEmail are required' },
        { status: 400 },
      );
    }

    if (expectedValue == null || typeof expectedValue !== 'number' || expectedValue < 0) {
      return NextResponse.json(
        { error: 'expectedValue must be a non-negative number' },
        { status: 400 },
      );
    }

    // Check for conflict before registering
    const conflict = checkConflict(ctx.tenantId, contactEmail);
    if (conflict && conflict.partnerId !== partnerId) {
      return NextResponse.json(
        { error: 'Deal already registered by another partner for this contact', conflictId: conflict.id },
        { status: 409 },
      );
    }

    const registration = registerDeal(partnerId, ctx.tenantId, {
      dealTitle,
      contactName,
      contactEmail,
      expectedValue,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    return NextResponse.json({ data: registration }, { status: 201 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant partner deals POST', requestMethod: 'POST' });

    // Return 404 for partner-not-found, 400 for partner-inactive
    if (err.message === 'Partner not found') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err.message === 'Partner is not active') {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    return apiError(err);
  }
});

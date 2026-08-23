/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import {
  createPartner,
  getPartnersByTenant,
} from '@/lib/partners';
import type { PartnerType, PartnerStatus } from '@/lib/partners';

/**
 * GET /api/tenant/partners
 * List all partners for the current tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const partners = getPartnersByTenant(ctx.tenantId);
    return NextResponse.json({ data: partners, total: partners.length });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tenant partners GET]', err);
    return apiError(err);
  }
}

/**
 * POST /api/tenant/partners
 * Create a new partner (admin only).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'partners.create');
    if (deny) return deny;

    const body = await request.json();
    const { name, email, type, commissionRate, metadata } = body;

    if (!name || !email || !type) {
      return NextResponse.json(
        { error: 'name, email, and type are required' },
        { status: 400 },
      );
    }

    const validTypes: PartnerType[] = ['reseller', 'referral', 'distributor'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(', ')}` },
        { status: 400 },
      );
    }

    if (commissionRate != null && (typeof commissionRate !== 'number' || commissionRate < 0)) {
      return NextResponse.json(
        { error: 'commissionRate must be a non-negative number' },
        { status: 400 },
      );
    }

    const status: PartnerStatus = 'active';

    const partner = createPartner(ctx.tenantId, {
      name,
      email,
      type,
      status,
      commissionRate: commissionRate ?? 10,
      metadata: metadata ?? {},
    });

    return NextResponse.json({ data: partner }, { status: 201 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tenant partners POST]', err);
    return apiError(err);
  }
}

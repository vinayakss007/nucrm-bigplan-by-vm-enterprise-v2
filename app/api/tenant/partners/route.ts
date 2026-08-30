/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import {
  createPartner,
  getPartnersByTenant,
} from '@/lib/partners';
import type { PartnerStatus } from '@/lib/partners';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

// Mirrors the fields the POST handler consumes and its previous manual checks:
// name/email/type required, type constrained to the known PartnerType enum,
// commissionRate an optional non-negative number, metadata an optional object.
// email is kept as a non-empty string (not .email()) to avoid rejecting
// requests the previous truthiness check would have accepted.
const createPartnerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1),
  type: z.enum(['reseller', 'referral', 'distributor']),
  commissionRate: z.number().min(0).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * GET /api/tenant/partners
 * List all partners for the current tenant.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const partners = getPartnersByTenant(ctx.tenantId);
    return NextResponse.json({ data: partners, total: partners.length });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant partners GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

/**
 * POST /api/tenant/partners
 * Create a new partner (admin only).
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'partners.create');
    if (deny) return deny;

    const raw = await readJsonBody(request);
    const validated = validateBody(createPartnerSchema, raw);
    if (validated instanceof NextResponse) return validated;
    const { name, email, type, commissionRate, metadata } = validated.data;

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
    await logError({ error: err, context: 'tenant partners POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

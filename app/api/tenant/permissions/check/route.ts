/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, can } from '@/lib/auth/middleware';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { z } from 'zod';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const parsed = validateBody(z.object({ permission: z.string().min(1).max(100).optional() }), await readJsonBody(request));
    if (parsed instanceof NextResponse) return parsed;
    const { permission } = parsed.data;
    if (!permission) return NextResponse.json({ error: 'permission required' }, { status: 400 });
    return NextResponse.json({ allowed: can(ctx, permission), roleSlug: ctx.roleSlug });
 
 
  } catch (err) { return apiError(err); }
});

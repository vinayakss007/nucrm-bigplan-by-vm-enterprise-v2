/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { validateBody } from '@/lib/api/validate';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import {
  linkRecords,
  getLinkedRecords,
  unlinkRecords,
  RecordLinkError,
} from '@/lib/record-links';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * Arbitrary "related records" associations.
 *
 * GET    ?entityType=ticket&entityId=<uuid>   list everything linked to a record
 * POST   { fromType, fromId, toType, toId, relation?, note? }
 * DELETE ?id=<linkId>
 *
 * A RecordLinkError is always the caller's fault (unknown entity type, self
 * link, or an endpoint that is not in this tenant), so it maps to 400 rather
 * than leaking through as a 500.
 */

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');

    if (!entityType || !entityId) {
      return badRequest('entityType and entityId are required');
    }

    const data = await getLinkedRecords(ctx.tenantId, entityType, entityId);
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof RecordLinkError) return badRequest(err.message);
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'api', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const validated = validateBody(z.object({
      fromType: z.string().min(1),
      fromId: z.string().min(1),
      toType: z.string().min(1),
      toId: z.string().min(1),
      relation: z.string().max(100).optional(),
      note: z.string().max(2000).optional(),
    }), await readJsonBody(request));
    if (validated instanceof NextResponse) return validated;
    const { fromType, fromId, toType, toId, relation, note } = validated.data;

    const link = await linkRecords({
      tenantId: ctx.tenantId,
      fromType,
      fromId,
      toType,
      toId,
      ...(relation ? { relation } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(ctx.userId ? { userId: ctx.userId } : {}),
    });

    return NextResponse.json({ data: link }, { status: 201 });
  } catch (err) {
    if (err instanceof RecordLinkError) return badRequest(err.message);
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'api', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return badRequest('id is required');

    const removed = await unlinkRecords(ctx.tenantId, id, ctx.userId);
    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RecordLinkError) return badRequest(err.message);
    return apiError(err);
  }
});

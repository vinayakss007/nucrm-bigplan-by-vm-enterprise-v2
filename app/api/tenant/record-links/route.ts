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

export async function GET(request: NextRequest) {
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
}

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'api', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return badRequest('Invalid JSON');
    }

    const { fromType, fromId, toType, toId, relation, note } = body as {
      fromType?: string; fromId?: string; toType?: string; toId?: string;
      relation?: string; note?: string;
    };

    if (!fromType || !fromId || !toType || !toId) {
      return badRequest('fromType, fromId, toType and toId are required');
    }

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
}

export async function DELETE(request: NextRequest) {
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
}

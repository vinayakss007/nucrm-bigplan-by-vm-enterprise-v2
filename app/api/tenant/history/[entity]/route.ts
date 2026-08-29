/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { getEntityHistory, getEntitySnapshots, type EntityType } from '@/lib/history';
import { parseLimitOffset } from '@/lib/api/query-params';
import { withApiRoute } from '@/lib/api/with-api-route';

const VALID_ENTITIES = ['contact', 'company', 'deal', 'lead', 'task'];

export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { entity } = await params;
    if (!VALID_ENTITIES.includes(entity)) {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get('entity_id');
    const type = searchParams.get('type') || 'changes';
    const { limit } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });

    if (!entityId) {
      return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
    }

    if (type === 'snapshots') {
      const snapshots = await getEntitySnapshots(
        ctx.tenantId,
        entity as EntityType,
        entityId
      );
      return NextResponse.json({ 
        data: snapshots.map(s => ({
          ...s,
          snapshotData: JSON.parse(s.snapshotData || '{}')
        }))
      });
    }

    const history = await getEntityHistory(
      ctx.tenantId,
      entity as EntityType,
      entityId,
      limit
    );

    return NextResponse.json({ data: history });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[history GET]', err);
    return apiError(err);
  }
});
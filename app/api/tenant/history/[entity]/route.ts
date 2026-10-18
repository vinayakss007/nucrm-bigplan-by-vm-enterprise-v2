/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { requireAuth, type AuthContext } from '@/lib/auth/middleware';
import { ownerScope } from '@/lib/api/owner-scope';
import { db } from '@/drizzle/db';
import { companies, contacts, deals, leads, tasks } from '@/drizzle/schema';
import { getEntityHistory, getEntitySnapshots, type EntityType } from '@/lib/history';
import { parseLimitOffset } from '@/lib/api/query-params';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

/** The five entities share the same four columns; only the relation differs. */
type OwneredTable = typeof contacts | typeof companies | typeof deals | typeof leads | typeof tasks;

/**
 * Does this caller have the record behind the trail they are asking for?
 *
 * The gate deliberately excludes `deleted_at`: a merged duplicate (#2702) and a
 * trashed record keep their history, and the tombstone says nothing about who
 * may read it. `viewAll: null` is the `companies` case — `companies.view_all`
 * exists (`lib/permissions/definitions.ts:43`) and is enforced nowhere (#2597),
 * so it stays tenant-only here exactly as in `notes/bulk` (#2699) and
 * `data-explorer` (#2704).
 */
async function rowVisible(
  ctx: AuthContext,
  table: OwneredTable,
  viewAll: string | null,
  entityId: string,
): Promise<boolean> {
  const [hit] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(
      eq(table.id, entityId),
      eq(table.tenantId, ctx.tenantId),
      viewAll ? ownerScope(ctx, viewAll, table) : undefined,
    ))
    .limit(1);
  return hit !== undefined;
}

// The lookup is the validation: deriving the accepted list from the gates keeps
// the 400 check and the owner rule from drifting apart.
const HISTORY_GATES: Record<string, (ctx: AuthContext, entityId: string) => Promise<boolean>> = {
  contact: (ctx, id) => rowVisible(ctx, contacts, 'contacts.view_all', id),
  company: (ctx, id) => rowVisible(ctx, companies, null, id),
  deal: (ctx, id) => rowVisible(ctx, deals, 'deals.view_all', id),
  lead: (ctx, id) => rowVisible(ctx, leads, 'leads.view_all', id),
  task: (ctx, id) => rowVisible(ctx, tasks, 'tasks.view_all', id),
};

export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { entity } = await params;
    const gate = HISTORY_GATES[entity];
    if (!gate) {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get('entity_id');
    const type = searchParams.get('type') || 'changes';
    const { limit } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });

    if (!entityId) {
      return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
    }

    // Reading a record's trail is reading the record: `edit_history` rows carry
    // `old_value` / `new_value` for every field, plus the editor's name, email,
    // IP address and user agent (`drizzle/schema/history.ts:17-32`), and the
    // snapshots branch below returns the whole row. `contacts/[id]` answers 404
    // for a row a caller without `contacts.view_all` does not own, so this route
    // has to answer the same thing — the verb that does not confirm the id
    // exists (#2712).
    if (!(await gate(ctx, entityId))) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
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
 
 
  } catch (err) {
    await logError({ error: err, context: 'history GET', requestMethod: 'GET' });
    return apiError(err);
  }
});
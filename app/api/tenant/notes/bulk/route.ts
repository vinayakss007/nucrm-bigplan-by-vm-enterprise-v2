/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notes, contacts, deals, leads, companies, tasks } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { AnyPgTable, PgColumn } from 'drizzle-orm/pg-core';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';
import { readJsonBody } from '@/lib/api/validate';
import { ownerScope } from '@/lib/api/owner-scope';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
const MAX_BULK = 500;
const VALID_ENTITY_TYPES = ['contact', 'deal', 'lead', 'company', 'task'] as const;

const entityTables: Record<string, {
  table: AnyPgTable;
  idField: PgColumn;
  tenantField: PgColumn;
  assignedTo: PgColumn;
  createdBy: PgColumn;
  viewAll: string | null;
}> = {
  contact: { table: contacts, idField: contacts.id, tenantField: contacts.tenantId, assignedTo: contacts.assignedTo, createdBy: contacts.createdBy, viewAll: 'contacts.view_all' },
  deal: { table: deals, idField: deals.id, tenantField: deals.tenantId, assignedTo: deals.assignedTo, createdBy: deals.createdBy, viewAll: 'deals.view_all' },
  lead: { table: leads, idField: leads.id, tenantField: leads.tenantId, assignedTo: leads.assignedTo, createdBy: leads.createdBy, viewAll: 'leads.view_all' },
  // #2699 — `companies.view_all` is defined (lib/permissions/definitions.ts:43)
  // and enforced nowhere: neither companies/route.ts nor companies/[id]/route.ts
  // references it, so the entity has no owner rule to be consistent with. Gating
  // this one bulk write on it would invent a rule the rest of the entity does not
  // have; `null` keeps the branch tenant-scoped until that decision is made.
  company: { table: companies, idField: companies.id, tenantField: companies.tenantId, assignedTo: companies.assignedTo, createdBy: companies.createdBy, viewAll: null },
  task: { table: tasks, idField: tasks.id, tenantField: tasks.tenantId, assignedTo: tasks.assignedTo, createdBy: tasks.createdBy, viewAll: 'tasks.view_all' },
};

export const POST = withApiRoute(async (req: NextRequest) => {
  let ctx!: AuthContext;
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    ctx = auth;

    const body = await readJsonBody(req);
    const { entity_type, entity_ids, content } = body;

    if (!entity_type || !VALID_ENTITY_TYPES.includes(entity_type)) {
      return NextResponse.json(
        { error: `entity_type must be one of: ${VALID_ENTITY_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!Array.isArray(entity_ids) || !entity_ids.length) {
      return NextResponse.json({ error: 'entity_ids array required' }, { status: 400 });
    }

    if (entity_ids.length > MAX_BULK) {
      return NextResponse.json({ error: `Max ${MAX_BULK} entities per bulk operation` }, { status: 400 });
    }

    if (!content?.trim()) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }

    const limited = await rateLimitMutating(req, 'bulk', 'post');
    if (limited) return limited;

    const entityTable = entityTables[entity_type];
    if (!entityTable) {
      return NextResponse.json({ error: `Unsupported entity type: ${entity_type}` }, { status: 400 });
    }

    // #2699 — the id set this route writes was scoped by tenant and tombstone
    // only, while every entity it serves answers 404 on the record path unless
    // the row is `assigned_to` or `created_by` the caller (#2671, #2673, #2674,
    // #2692). Up to MAX_BULK foreign ids were accepted, one note attached to each.
    // Narrowing here is enough: `noteValues` below is built from `validIds`.
    const mine = entityTable.viewAll
      ? ownerScope(ctx, entityTable.viewAll, { assignedTo: entityTable.assignedTo, createdBy: entityTable.createdBy })
      : undefined;

    const valid = await db
      .select({ id: entityTable.idField })
      .from(entityTable.table)
      .where(
        and(
          inArray(entityTable.idField, entity_ids),
          eq(entityTable.tenantField, ctx.tenantId),
          sql`deleted_at IS NULL`,
          mine
        )
      );

    const validIds = valid.map((r) => r.id as string);
    if (!validIds.length) {
      return NextResponse.json({ error: 'No valid entities found' }, { status: 404 });
    }

    const noteValues = validIds.map((entityId: string) => ({
      tenantId: ctx.tenantId,
      entityType: entity_type,
      entityId,
      content: content.trim(),
      createdBy: ctx.userId,
    }));

    await db.insert(notes).values(noteValues);

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'bulk_add_note',
      entityType: entity_type,
      newData: { count: validIds.length, entity_ids: validIds.slice(0, 20) },
    });

    return NextResponse.json({ ok: true, affected: validIds.length });

  } catch (err) {
    await logError({ error: err, context: 'notes/bulk', tenantId: ctx?.tenantId, requestMethod: 'POST' });
    return apiError(err);
  }
});

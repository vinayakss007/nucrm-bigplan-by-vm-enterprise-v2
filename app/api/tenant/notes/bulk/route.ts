import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notes, contacts, deals, leads, companies, tasks } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';

const MAX_BULK = 500;
const VALID_ENTITY_TYPES = ['contact', 'deal', 'lead', 'company', 'task'] as const;

const entityTables: Record<string, { table: any; idField: any; tenantField: any }> = {
  contact: { table: contacts, idField: contacts.id, tenantField: contacts.tenantId },
  deal: { table: deals, idField: deals.id, tenantField: deals.tenantId },
  lead: { table: leads, idField: leads.id, tenantField: leads.tenantId },
  company: { table: companies, idField: companies.id, tenantField: companies.tenantId },
  task: { table: tasks, idField: tasks.id, tenantField: tasks.tenantId },
};

export async function POST(req: NextRequest) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
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

    const entityTable = entityTables[entity_type];
    if (!entityTable) {
      return NextResponse.json({ error: `Unsupported entity type: ${entity_type}` }, { status: 400 });
    }

    const valid = await db
      .select({ id: entityTable.idField })
      .from(entityTable.table)
      .where(
        and(
          inArray(entityTable.idField, entity_ids),
          eq(entityTable.tenantField, ctx.tenantId),
          sql`deleted_at IS NULL`
        )
      );

    const validIds = valid.map(r => r.id);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[notes bulk POST]', err);
    await logError({ error: err, context: 'notes/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
}

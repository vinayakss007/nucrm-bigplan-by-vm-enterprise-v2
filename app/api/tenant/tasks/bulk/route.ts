/**
 * Bulk Task Operations
 * POST /api/tenant/tasks/bulk
 * Body: { action, task_ids, payload? }
 * Actions: assign, priority, complete, reopen, due, delete
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tasks, tenantMembers, segments, segmentMembers } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';

const MAX_BULK = 500;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export async function POST(req: NextRequest) {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { action, task_ids, payload = {} } = body;

    if (!Array.isArray(task_ids) || !task_ids.length)
      return NextResponse.json({ error: 'task_ids array required' }, { status: 400 });
    if (task_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} tasks per bulk operation` }, { status: 400 });

    // Validate IDs belong to this tenant
    const valid = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          inArray(tasks.id, task_ids),
          eq(tasks.tenantId, ctx.tenantId),
          sql`${tasks.deletedAt} IS NULL`
        )
      );

    const validIds = valid.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid tasks found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'assign': {
        const deny = requirePerm(ctx, 'tasks.assign');
        if (deny) return deny;
        const assignTo = payload.assigned_to as string | undefined;
        if (!assignTo) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });

        const [member] = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.userId, assignTo),
              eq(tenantMembers.tenantId, ctx.tenantId),
              eq(tenantMembers.status, 'active')
            )
          )
          .limit(1);
        if (!member) return NextResponse.json({ error: 'Assignee not found in this workspace' }, { status: 404 });

        const res = await db
          .update(tasks)
          .set({
            assignedTo: assignTo,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'priority': {
        const deny = requirePerm(ctx, 'tasks.edit');
        if (deny) return deny;
        const priority = payload.priority as string | undefined;
        if (!priority || !PRIORITIES.includes(priority))
          return NextResponse.json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` }, { status: 400 });

        const res = await db
          .update(tasks)
          .set({
            priority,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'complete': {
        const deny = requirePerm(ctx, 'tasks.edit');
        if (deny) return deny;
        const now = new Date();
        const res = await db
          .update(tasks)
          .set({
            completed: true,
            status: 'completed',
            completedAt: now,
            updatedAt: now,
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'reopen': {
        const deny = requirePerm(ctx, 'tasks.edit');
        if (deny) return deny;
        const res = await db
          .update(tasks)
          .set({
            completed: false,
            status: 'pending',
            completedAt: null,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'due': {
        const deny = requirePerm(ctx, 'tasks.edit');
        if (deny) return deny;
        const dueRaw = payload.due_date as string | null | undefined;
        let due: Date | null = null;
        if (dueRaw) {
          const d = new Date(dueRaw);
          if (Number.isNaN(d.getTime()))
            return NextResponse.json({ error: 'due_date is invalid' }, { status: 400 });
          due = d;
        }

        const res = await db
          .update(tasks)
          .set({
            dueDate: due,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'delete': {
        const deny = requirePerm(ctx, 'tasks.delete');
        if (deny) return deny;
        const res = await db
          .update(tasks)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId),
              sql`${tasks.deletedAt} IS NULL`
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'update_field': {
        const deny = requirePerm(ctx, 'tasks.edit');
        if (deny) return deny;
        const fieldKey = payload['field_key'] as string | undefined;
        const fieldValue = payload['field_value'];
        if (!fieldKey) return NextResponse.json({ error: 'field_key required' }, { status: 400 });
        
        const res = await db
          .update(tasks)
          .set({
            metadata: sql`jsonb_set(COALESCE(${tasks.metadata}, '{}'::jsonb), ${'{"' + fieldKey + '"}'}::text[], ${JSON.stringify(fieldValue)}::jsonb, true)`,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }

      case 'archive': {
        const deny = requirePerm(ctx, 'tasks.delete');
        if (deny) return deny;
        const res = await db
          .update(tasks)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'restore': {
        const deny = requirePerm(ctx, 'tasks.edit');
        if (deny) return deny;
        const res = await db
          .update(tasks)
          .set({
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(tasks.id, validIds),
              eq(tasks.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'add_to_segment': {
        const segId = payload['segment_id'] as string | undefined;
        if (!segId) return NextResponse.json({ error: 'segment_id required' }, { status: 400 });
        const [seg] = await db.select({ id: segments.id }).from(segments)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, ctx.tenantId)))
          .limit(1);
        if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
        const memberValues = validIds.map(entityId => ({ segmentId: segId, entityId, tenantId: ctx.tenantId }));
        const resSeg = await db.insert(segmentMembers).values(memberValues).onConflictDoNothing();
        affected = resSeg.rowCount ?? memberValues.length;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, entityType: 'task',
      newData: { count: affected, task_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tasks bulk POST]', err);
    await logError({ error: err, context: 'tasks/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm, can, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities } from '@/drizzle/schema';
import { users } from '@/drizzle/schema';
import { companies, contacts, deals, supportTickets, tasks } from '@/drizzle/schema';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { isEntityId } from '@/lib/id';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { parseLimitOffset } from '@/lib/api/query-params';
import { ownerScope } from '@/lib/api/owner-scope';

const createActivitySchema = z.object({
  type: z.string().min(1, 'type is required'),
  description: z.string().min(1, 'description is required'),
  deal_id: uuidIdSchema.optional().nullable(),
  contact_id: uuidIdSchema.optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  eventType: z.string().optional(),
});

/** The five records a feed request can name, and the rules they answer for. */
type FeedTarget = {
  param: string;
  entityType: string;
  table: typeof contacts | typeof deals | typeof tasks | typeof companies | typeof supportTickets;
  /** The `<entity>.view_all` the entity's own routes enforce, or null where there is none. */
  viewAll: string | null;
  /** Set only on the two targets POST can name; null means the target is not postable. */
  editPerm: string | null;
};

/**
 * `activities` has no owner column of its own — it carries the polymorphic
 * `entity_type`/`entity_id` pair plus four denormalised FKs (`activity.ts:16-26`),
 * and this route's own writes populate only the pair. So the feed borrows the
 * rule of whichever record a request names, which is exactly what makes the
 * borrow sound: `?deal_id=` answers for a deal, so it answers with the deal's
 * rule.
 *
 * `companies` and `tickets` carry `viewAll: null`. `companies.view_all` is defined
 * (`lib/permissions/definitions.ts:43`) and enforced nowhere (#2597), and there is
 * no `tickets.view_all` in the catalogue at all, so a timeline of either stays
 * tenant-wide — the same stated gap #2699, #2704, #2712 and #2716 leave rather
 * than inventing a rule.
 *
 * The order is the old if/else chain's precedence, unchanged.
 */
const FEED_TARGETS: FeedTarget[] = [
  { param: 'contact_id', entityType: 'contact', table: contacts, viewAll: 'contacts.view_all', editPerm: 'contacts.edit' },
  { param: 'deal_id', entityType: 'deal', table: deals, viewAll: 'deals.view_all', editPerm: 'deals.edit' },
  { param: 'company_id', entityType: 'company', table: companies, viewAll: null, editPerm: null },
  { param: 'task_id', entityType: 'task', table: tasks, viewAll: 'tasks.view_all', editPerm: null },
  { param: 'ticket_id', entityType: 'ticket', table: supportTickets, viewAll: null, editPerm: null },
];

/** The rights that make a caller a reader of other people's records. */
const FEED_VIEW_ALL = ['contacts.view_all', 'leads.view_all', 'deals.view_all', 'tasks.view_all', 'companies.view_all'];

/**
 * Can this caller name the record behind the timeline they are asking for?
 *
 * The gate is the entity's own: `contacts/[id]:82-87`, `deals/[id]:66-71` and
 * `tasks/[id]:55-59` answer 404 for a `sales_rep`
 * (`lib/permissions/definitions.ts:132-137`) reaching a row that is neither
 * `assigned_to` nor `created_by` them, and this says the same thing. It
 * deliberately does not ask a `*.view` permission — `contacts.view` and
 * `tasks.view` are not in the catalogue (#2597), so asking them here would 403
 * the one role whose timelines these components render.
 */
async function targetVisible(ctx: AuthContext, target: FeedTarget, entityId: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: target.table.id })
    .from(target.table)
    .where(and(
      eq(target.table.id, entityId),
      eq(target.table.tenantId, ctx.tenantId),
      target.viewAll ? ownerScope(ctx, target.viewAll, target.table) : undefined,
    ))
    .limit(1);
  return hit !== undefined;
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('event_type');
    const { limit, offset } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });

    // #3116 — the tombstone belongs in the shared array, not in either query:
    // the count below and the page below it read from this one list, and a
    // deleted row dropped from one and not the other shifts `total` and
    // `hasMore` while the list itself still looks right. Written by
    // DELETE /api/tenant/contacts/[id]/notes; already read this way by
    // dashboard/stats, widgets/activity and lib/activity/timeline.
    const conditions = [eq(activities.tenantId, ctx.tenantId), isNull(activities.deletedAt)];

    // Naming a record is answered with that record's own rule, and a name that
    // does not resolve is a 404 rather than an empty 200 — the empty 200 tells
    // the caller the id is someone else's, which is what a timeline of a record
    // they cannot open should not do.
    const named = FEED_TARGETS.find((t) => searchParams.get(t.param));
    const namedId = named ? searchParams.get(named.param) : null;
    if (named && namedId) {
      if (!isEntityId(namedId) || !(await targetVisible(ctx, named, namedId))) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
      conditions.push(eq(activities.entityType, named.entityType));
      conditions.push(eq(activities.entityId, namedId));
    } else if (!FEED_VIEW_ALL.some((perm) => can(ctx, perm))) {
      // The unfiltered feed is the one question with no record to borrow a rule
      // from, so it falls back to the actor: `activities` has no owner column,
      // but every row states who did it, and `idx_activities_user`
      // (`activity.ts:44`) already indexes tenant + actor + recency. A caller who
      // holds none of the five `view_all` rights — `sales_rep` among them — reads
      // their own trail; a manager or viewer, who holds them, reads the tenant's.
      // Per-record history is not lost either way: `?deal_id=` above still returns
      // every actor's entry on a record the caller can open.
      conditions.push(eq(activities.userId, ctx.userId));
    }

    if (eventType) {
      conditions.push(eq(activities.eventType, eventType));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(...conditions));

    const results = await db.select({
      id: activities.id,
      userId: activities.userId,
      entityType: activities.entityType,
      entityId: activities.entityId,
      action: activities.action,
      description: activities.description,
      metadata: activities.metadata,
      createdAt: activities.createdAt,
      userName: users.fullName
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(and(...conditions))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({
      data: results || [],
      total: countResult?.count ?? 0,
      limit,
      offset,
      hasMore: offset + results.length < (countResult?.count ?? 0),
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'activities GET', requestMethod: 'GET' });
    return apiError(err, "Internal server error", 200);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'activities', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const raw = await readJsonBody(request);
    const parsed = validateBody(createActivitySchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { type, description, deal_id, contact_id, metadata } = parsed.data;

    // A timeline entry names a record, so it is written under that record's two
    // rules: the edit right its route asks for, and the row rule that record
    // answers 404 on. Before this, POST validated the shape of the body and
    // stamped whatever `entity_id` arrived — no existence check (`entityId` has
    // no FK, `activity.ts:17`), no owner rule, no permission — so any signed-in
    // user could forge an entry onto any id in the tenant.
    const targetType = deal_id ? 'deal' : contact_id ? 'contact' : null;
    const entityId = deal_id || contact_id || null;
    const target = targetType ? FEED_TARGETS.find((t) => t.entityType === targetType) : undefined;
    if (target?.editPerm && entityId) {
      const deny = requirePerm(ctx, target.editPerm);
      if (deny) return deny;
      if (!(await targetVisible(ctx, target, entityId))) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
    }

    const [newActivity] = await db.insert(activities)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityType: target?.entityType ?? 'other',
        entityId: entityId ?? ctx.userId,
        eventType: type,
        description,
        metadata
      } as typeof activities.$inferInsert)
      .returning();

    return NextResponse.json({ data: newActivity }, { status: 201 });
 
 
  } catch (err) {
    await logError({ error: err, context: 'activities POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

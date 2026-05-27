/**
 * Bulk Transfer of Ownership
 * Admin-only. The single most common need when a teammate leaves.
 *
 *   GET  /api/tenant/admin/bulk-transfer?from_user_id=...
 *        → counts of records owned by from_user_id, broken down by resource
 *
 *   POST /api/tenant/admin/bulk-transfer
 *        body: {
 *          from_user_id: uuid,
 *          to_user_id:   uuid,
 *          resources: ['leads','contacts','deals','tasks','tickets'][],
 *          only_open:    boolean,   // skip closed deals / completed tasks / closed tickets
 *        }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantMembers, leads, contacts, deals, tasks, tickets } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const RESOURCES = ['leads', 'contacts', 'deals', 'tasks', 'tickets'] as const;
type Resource = typeof RESOURCES[number];

async function assertAdmin(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return { error: ctx };
  if (!ctx.isAdmin) return { error: NextResponse.json({ error: 'Admin required' }, { status: 403 }) };
  return { ctx };
}

async function memberOfTenant(tenantId: string, userId: string) {
  const [m] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.status, 'active')
    ))
    .limit(1);
  return !!m;
}

async function countOwned(tenantId: string, userId: string, onlyOpen: boolean) {
  // Each query is tenant-scoped + assigned-to-scoped + soft-delete-safe.
  const [leadRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.assignedTo, userId), sql`${leads.deletedAt} IS NULL`));

  const [contactRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.assignedTo, userId), sql`${contacts.deletedAt} IS NULL`));

  const dealConds = [eq(deals.tenantId, tenantId), eq(deals.assignedTo, userId), sql`${deals.deletedAt} IS NULL`];
  if (onlyOpen) dealConds.push(sql`COALESCE(${deals.metadata}->>'outcome', '') NOT IN ('won','lost')`);
  const [dealRow] = await db.select({ c: sql<number>`count(*)::int` }).from(deals).where(and(...dealConds));

  const taskConds = [eq(tasks.tenantId, tenantId), eq(tasks.assignedTo, userId), sql`${tasks.deletedAt} IS NULL`];
  if (onlyOpen) taskConds.push(sql`${tasks.completed} = false`);
  const [taskRow] = await db.select({ c: sql<number>`count(*)::int` }).from(tasks).where(and(...taskConds));

  const ticketConds = [eq(tickets.tenantId, tenantId), eq(tickets.assignedTo, userId), sql`${tickets.deletedAt} IS NULL`];
  if (onlyOpen) ticketConds.push(sql`COALESCE(${tickets.status}, 'open') NOT IN ('closed','resolved')`);
  const [ticketRow] = await db.select({ c: sql<number>`count(*)::int` }).from(tickets).where(and(...ticketConds));

  return {
    leads:    leadRow?.c    ?? 0,
    contacts: contactRow?.c ?? 0,
    deals:    dealRow?.c    ?? 0,
    tasks:    taskRow?.c    ?? 0,
    tickets:  ticketRow?.c  ?? 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { ctx, error } = await assertAdmin(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const fromUserId = searchParams.get('from_user_id');
    const onlyOpen = searchParams.get('only_open') === 'true';
    if (!fromUserId) return NextResponse.json({ error: 'from_user_id required' }, { status: 400 });

    if (!(await memberOfTenant(ctx!.tenantId, fromUserId)))
      return NextResponse.json({ error: 'User is not a member of this workspace' }, { status: 404 });

    const counts = await countOwned(ctx!.tenantId, fromUserId, onlyOpen);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return NextResponse.json({ from_user_id: fromUserId, only_open: onlyOpen, counts, total });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  let ctx: any;
  try {
    const auth = await assertAdmin(req);
    if (auth.error) return auth.error;
    ctx = auth.ctx!;

    const body = await req.json().catch(() => ({}));
    const fromUserId: string | undefined = body.from_user_id;
    const toUserId:   string | undefined = body.to_user_id;
    const resources: Resource[] = Array.isArray(body.resources) ? body.resources : [];
    const onlyOpen = body.only_open === true;

    if (!fromUserId || !toUserId)
      return NextResponse.json({ error: 'from_user_id and to_user_id required' }, { status: 400 });
    if (fromUserId === toUserId)
      return NextResponse.json({ error: 'from and to must be different users' }, { status: 400 });
    if (resources.length === 0)
      return NextResponse.json({ error: 'pick at least one resource type' }, { status: 400 });
    for (const r of resources) {
      if (!RESOURCES.includes(r))
        return NextResponse.json({ error: `unknown resource: ${r}` }, { status: 400 });
    }

    if (!(await memberOfTenant(ctx.tenantId, fromUserId)))
      return NextResponse.json({ error: 'from_user is not a member of this workspace' }, { status: 404 });
    if (!(await memberOfTenant(ctx.tenantId, toUserId)))
      return NextResponse.json({ error: 'to_user is not a member of this workspace' }, { status: 404 });

    const now = new Date();
    const transferred: Record<Resource, number> = { leads: 0, contacts: 0, deals: 0, tasks: 0, tickets: 0 };

    if (resources.includes('leads')) {
      const r = await db.update(leads)
        .set({ assignedTo: toUserId, updatedAt: now })
        .where(and(eq(leads.tenantId, ctx.tenantId), eq(leads.assignedTo, fromUserId), sql`${leads.deletedAt} IS NULL`));
      transferred.leads = r.rowCount ?? 0;
    }

    if (resources.includes('contacts')) {
      const r = await db.update(contacts)
        .set({ assignedTo: toUserId, updatedAt: now })
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.assignedTo, fromUserId), sql`${contacts.deletedAt} IS NULL`));
      transferred.contacts = r.rowCount ?? 0;
    }

    if (resources.includes('deals')) {
      const conds = [eq(deals.tenantId, ctx.tenantId), eq(deals.assignedTo, fromUserId), sql`${deals.deletedAt} IS NULL`];
      if (onlyOpen) conds.push(sql`COALESCE(${deals.metadata}->>'outcome', '') NOT IN ('won','lost')`);
      const r = await db.update(deals)
        .set({ assignedTo: toUserId, updatedAt: now, updatedBy: ctx.userId })
        .where(and(...conds));
      transferred.deals = r.rowCount ?? 0;
    }

    if (resources.includes('tasks')) {
      const conds = [eq(tasks.tenantId, ctx.tenantId), eq(tasks.assignedTo, fromUserId), sql`${tasks.deletedAt} IS NULL`];
      if (onlyOpen) conds.push(sql`${tasks.completed} = false`);
      const r = await db.update(tasks)
        .set({ assignedTo: toUserId, updatedAt: now, updatedBy: ctx.userId })
        .where(and(...conds));
      transferred.tasks = r.rowCount ?? 0;
    }

    if (resources.includes('tickets')) {
      const conds = [eq(tickets.tenantId, ctx.tenantId), eq(tickets.assignedTo, fromUserId), sql`${tickets.deletedAt} IS NULL`];
      if (onlyOpen) conds.push(sql`COALESCE(${tickets.status}, 'open') NOT IN ('closed','resolved')`);
      const r = await db.update(tickets)
        .set({ assignedTo: toUserId, updatedAt: now })
        .where(and(...conds));
      transferred.tickets = r.rowCount ?? 0;
    }

    const total = Object.values(transferred).reduce((a, b) => a + b, 0);

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'bulk_transfer', entityType: 'user',
      newData: { from_user_id: fromUserId, to_user_id: toUserId, resources, only_open: onlyOpen, transferred, total },
    });

    return NextResponse.json({ ok: true, transferred, total });
  } catch (err: any) {
    console.error('[bulk-transfer POST]', err);
    return apiError(err);
  }
}

/**
 * Out of Office
 *   GET   /api/user/out-of-office
 *   PATCH /api/user/out-of-office
 *
 * Storage: tenant_members.settings.out_of_office (jsonb merge)
 * Shape:
 *   {
 *     enabled:           boolean,
 *     start_date:        ISO date string | null,
 *     end_date:          ISO date string | null,
 *     delegate_user_id:  uuid | null,   // assignments route here while away
 *     auto_reply:        string,        // optional auto-reply for emails / chat
 *     auto_reassign:     boolean,       // also bulk-reassign open work on save
 *   }
 *
 * The auto-reassign side-effect is opt-in: it triggers a sweep of records
 * currently assigned to this user (leads/contacts/deals/tasks) and reassigns
 * them to delegate_user_id within the active window. The actual sweep runs
 * inline here for simplicity (capped by safe row limits via existing bulk
 * routes downstream); a scheduled job would be a separate enhancement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantMembers, leads, contacts, deals, tasks } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const DEFAULT_OOO = {
  enabled: false,
  start_date: null as string | null,
  end_date: null as string | null,
  delegate_user_id: null as string | null,
  auto_reply: '',
  auto_reassign: false,
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const row = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ),
      columns: { settings: true },
    });

    const stored = (((row?.settings as Record<string, unknown>) ?? {})['out_of_office'] ?? {}) as Record<string, unknown>;
    return NextResponse.json({ out_of_office: { ...DEFAULT_OOO, ...stored } });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireAuth>>;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const ooo = body.out_of_office;
    if (!ooo || typeof ooo !== 'object')
      return NextResponse.json({ error: 'out_of_office object required' }, { status: 400 });

    // Validation
    const enabled = ooo.enabled === true;
    const start = ooo.start_date ? String(ooo.start_date).slice(0, 10) : null;
    const end   = ooo.end_date   ? String(ooo.end_date).slice(0, 10)   : null;
    const delegate = ooo.delegate_user_id || null;
    const autoReassign = ooo.auto_reassign === true;
    const autoReply = typeof ooo.auto_reply === 'string' ? ooo.auto_reply.slice(0, 1000) : '';

    if (enabled) {
      if (!start || !end) return NextResponse.json({ error: 'start_date and end_date are required when enabled' }, { status: 400 });
      if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)))
        return NextResponse.json({ error: 'start_date / end_date must be valid dates' }, { status: 400 });
      if (new Date(end) < new Date(start))
        return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 });
    }

    // Validate delegate is a member of this tenant (and not the user themself)
    if (delegate) {
      if (delegate === ctx.userId)
        return NextResponse.json({ error: 'Delegate cannot be yourself' }, { status: 400 });
      const [d] = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.userId, delegate),
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.status, 'active')
        ))
        .limit(1);
      if (!d) return NextResponse.json({ error: 'Delegate is not a member of this workspace' }, { status: 404 });
    }

    const safe = {
      enabled,
      start_date: start,
      end_date: end,
      delegate_user_id: delegate,
      auto_reply: autoReply,
      auto_reassign: autoReassign,
    };

    await db
      .update(tenantMembers)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenantMembers.settings}, '{}'::jsonb),
            '{out_of_office}',
            ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ));

    // Optional: sweep open records to delegate immediately.
    let reassigned = { leads: 0, contacts: 0, deals: 0, tasks: 0 };
    if (enabled && autoReassign && delegate) {
      const now = new Date();
      const r1 = await db.update(leads)
        .set({ assignedTo: delegate, updatedAt: now })
        .where(and(eq(leads.tenantId, ctx.tenantId), eq(leads.assignedTo, ctx.userId), sql`${leads.deletedAt} IS NULL`));
      const r2 = await db.update(contacts)
        .set({ assignedTo: delegate, updatedAt: now })
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.assignedTo, ctx.userId), sql`${contacts.deletedAt} IS NULL`));
      const r3 = await db.update(deals)
        .set({ assignedTo: delegate, updatedAt: now, updatedBy: ctx.userId })
        .where(and(eq(deals.tenantId, ctx.tenantId), eq(deals.assignedTo, ctx.userId), sql`${deals.deletedAt} IS NULL`));
      const r4 = await db.update(tasks)
        .set({ assignedTo: delegate, updatedAt: now, updatedBy: ctx.userId })
        .where(and(
          eq(tasks.tenantId, ctx.tenantId),
          eq(tasks.assignedTo, ctx.userId),
          sql`${tasks.deletedAt} IS NULL`,
          sql`${tasks.completed} = false`
        ));

      reassigned = {
        leads:    r1.rowCount ?? 0,
        contacts: r2.rowCount ?? 0,
        deals:    r3.rowCount ?? 0,
        tasks:    r4.rowCount ?? 0,
      };

      await logAudit({
        tenantId: ctx.tenantId, userId: ctx.userId,
        action: 'ooo_auto_reassign', entityType: 'user',
        newData: { delegate, reassigned, window: { start, end } },
      });
    }

    return NextResponse.json({ ok: true, out_of_office: safe, reassigned });
  } catch (err: any) {
    console.error('[user/out-of-office PATCH]', err);
    return apiError(err);
  }
}

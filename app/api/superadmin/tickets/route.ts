import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { supportTickets, tenants, users } from '@/drizzle/schema';
import { eq, and, sql, desc, or, asc, inArray } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const status = new URL(request.url).searchParams.get('status');
    const filters = [];
    if (status) {
      filters.push(eq(supportTickets.status, status));
    }

    const [tickets, counts] = await Promise.all([
      db
        .select({
          id: supportTickets.id,
          subject: supportTickets.subject,
          body: supportTickets.body,
          status: supportTickets.status,
          priority: supportTickets.priority,
          category: supportTickets.category,
          tenantId: supportTickets.tenantId,
          createdBy: supportTickets.createdBy,
          assignedTo: supportTickets.assignedTo,
          createdAt: supportTickets.createdAt,
          updatedAt: supportTickets.updatedAt,
          resolvedAt: supportTickets.resolvedAt,
          tenantName: tenants.name,
          userEmail: users.email,
          userName: users.fullName,
        })
        .from(supportTickets)
        .leftJoin(tenants, eq(tenants.id, supportTickets.tenantId))
        .leftJoin(users, eq(users.id, supportTickets.createdBy))
        .where(and(...filters))
        .orderBy(
          sql`CASE ${supportTickets.priority} WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`,
          desc(supportTickets.createdAt)
        )
        .limit(100),

      db
        .select({
          open: sql<number>`count(*) FILTER (WHERE ${supportTickets.status} = 'open')::int`,
          in_progress: sql<number>`count(*) FILTER (WHERE ${supportTickets.status} = 'in_progress')::int`,
          resolved: sql<number>`count(*) FILTER (WHERE ${supportTickets.status} = 'resolved')::int`,
          critical: sql<number>`count(*) FILTER (WHERE ${supportTickets.priority} = 'critical' AND ${supportTickets.status} NOT IN ('resolved', 'closed'))::int`,
        })
        .from(supportTickets)
        .then(rows => rows[0])
        .catch(() => ({ open: 0, in_progress: 0, resolved: 0, critical: 0 })),
    ]);

    return NextResponse.json({ tickets, counts });
  } catch (err: any) {
    console.error('[superadmin/tickets GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { subject, body, category = 'general', priority = 'normal', tenant_id } = await request.json();
    if (!subject || !body) return NextResponse.json({ error: 'subject and body required' }, { status: 400 });

    const tid = tenant_id || ctx.tenantId;

    const [row] = await db
      .insert(supportTickets)
      .values({
        tenantId: tid,
        createdBy: ctx.userId,
        subject,
        body,
        category,
        priority,
      })
      .returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    console.error('[superadmin/tickets POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id, status, resolution, assigned_to } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const updateData: any = { updatedAt: new Date() };
    if (status) {
      updateData.status = status;
      if (status === 'resolved') {
        updateData.resolvedAt = new Date();
      }
    }
    if (resolution !== undefined) {
      updateData.metadata = sql`jsonb_set(COALESCE(${supportTickets.metadata}, '{}'), '{resolution}', ${JSON.stringify(resolution)})`;
    }
    if (assigned_to !== undefined) {
      updateData.assignedTo = assigned_to;
    }

    const [row] = await db
      .update(supportTickets)
      .set(updateData)
      .where(eq(supportTickets.id, id))
      .returning();

    if (!row) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[superadmin/tickets PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


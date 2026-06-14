import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, companies } from '@/drizzle/schema';
import { eq, and, isNotNull, sql, desc } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const type = new URL(req.url).searchParams.get('type');

    const contactQuery = db
      .select({
        resource_type: sql<string>`'contact'`,
        id: contacts.id,
        tenant_id: contacts.tenantId,
        deleted_at: contacts.deletedAt,
        deleted_by: contacts.deletedBy,
        name: sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`,
        extra: contacts.leadStatus,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, ctx.tenantId), isNotNull(contacts.deletedAt)));

    const dealQuery = db
      .select({
        resource_type: sql<string>`'deal'`,
        id: deals.id,
        tenant_id: deals.tenantId,
        deleted_at: deals.deletedAt,
        deleted_by: deals.deletedBy,
        name: deals.title,
        extra: sql<string>`NULL`, // stage name would require join, keeping it simple for trash list
        email: sql<string>`NULL`,
      })
      .from(deals)
      .where(and(eq(deals.tenantId, ctx.tenantId), isNotNull(deals.deletedAt)));

    const taskQuery = db
      .select({
        resource_type: sql<string>`'task'`,
        id: tasks.id,
        tenant_id: tasks.tenantId,
        deleted_at: tasks.deletedAt,
        deleted_by: tasks.deletedBy,
        name: tasks.title,
        extra: tasks.priority,
        email: sql<string>`NULL`,
      })
      .from(tasks)
      .where(and(eq(tasks.tenantId, ctx.tenantId), isNotNull(tasks.deletedAt)));

    const companyQuery = db
      .select({
        resource_type: sql<string>`'company'`,
        id: companies.id,
        tenant_id: companies.tenantId,
        deleted_at: companies.deletedAt,
        deleted_by: companies.deletedBy,
        name: companies.name,
        extra: sql<string>`NULL`,
        email: sql<string>`NULL`,
      })
      .from(companies)
      .where(and(eq(companies.tenantId, ctx.tenantId), isNotNull(companies.deletedAt)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let items: any[] = [];
    if (type) {
      if (type === 'contact') items = await contactQuery.orderBy(desc(contacts.deletedAt)).limit(200);
      else if (type === 'deal') items = await dealQuery.orderBy(desc(deals.deletedAt)).limit(200);
      else if (type === 'task') items = await taskQuery.orderBy(desc(tasks.deletedAt)).limit(200);
      else if (type === 'company') items = await companyQuery.orderBy(desc(companies.deletedAt)).limit(200);
    } else {
      const results = await Promise.all([
        contactQuery.limit(100),
        dealQuery.limit(100),
        taskQuery.limit(100),
        companyQuery.limit(100)
      ]);
      items = results.flat().sort((a, b) => 
        new Date(b.deleted_at!).getTime() - new Date(a.deleted_at!).getTime()
      );
    }

    const now = Date.now();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withExpiry = items.map((item: any) => ({
      ...item,
      days_remaining: Math.max(0, 30 - Math.floor((now - new Date(item.deleted_at).getTime()) / 86400000)),
    }));

    return NextResponse.json({ data: withExpiry, total: withExpiry.length });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id, resource_type } = await req.json();
    if (!id || !resource_type) return NextResponse.json({ error: 'id and resource_type required' }, { status: 400 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableMap: Record<string, any> = {
      contact: contacts, deal: deals, task: tasks, company: companies,
    };
    const table = tableMap[resource_type];
    if (!table) return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { deletedAt: null, deletedBy: null, updatedAt: new Date() };
    if (resource_type === 'contact') updateData.isArchived = false;

    const [row] = await db
      .update(table)
      .set(updateData)
      .where(and(eq(table.id, id), eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt)))
      .returning({ id: table.id });

    if (!row) return NextResponse.json({ error: 'Not found in trash' }, { status: 404 });

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:`restore`, entityType: resource_type, entityId: id });
    return NextResponse.json({ ok: true, message: `${resource_type} restored successfully` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required to permanently delete' }, { status: 403 });

    const { id, resource_type, purge_all } = await req.json();

    if (purge_all) {
      const result = await db.execute(sql`SELECT public.purge_trash() as count`);
      return NextResponse.json({ ok: true, purged: (result.rows[0] as Record<string, unknown>)?.count as number ?? 0 });
    }

    if (!id || !resource_type) return NextResponse.json({ error: 'id and resource_type required' }, { status: 400 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableMap: Record<string, any> = {
      contact: contacts, deal: deals, task: tasks, company: companies,
    };
    const table = tableMap[resource_type];
    if (!table) return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 });

    const result = await db
      .delete(table)
      .where(and(eq(table.id, id), eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt)));
      
    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found in trash' }, { status: 404 });
    
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'permanent_delete', entityType: resource_type, entityId: id });
    return NextResponse.json({ ok: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

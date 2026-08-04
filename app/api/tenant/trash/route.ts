import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, companies, leads, projects, tenants } from '@/drizzle/schema';
import { eq, and, isNotNull, sql, desc } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';

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

    const leadQuery = db
      .select({
        resource_type: sql<string>`'lead'`,
        id: leads.id,
        tenant_id: leads.tenantId,
        deleted_at: leads.deletedAt,
        deleted_by: leads.deletedBy,
        name: sql<string>`${leads.firstName} || ' ' || ${leads.lastName}`,
        extra: leads.leadStatus,
        email: sql<string>`NULL`,
      })
      .from(leads)
      .where(and(eq(leads.tenantId, ctx.tenantId), isNotNull(leads.deletedAt)));

    const projectQuery = db
      .select({
        resource_type: sql<string>`'project'`,
        id: projects.id,
        tenant_id: projects.tenantId,
        deleted_at: projects.deletedAt,
        deleted_by: projects.deletedBy,
        name: projects.name,
        extra: projects.status,
        email: sql<string>`NULL`,
      })
      .from(projects)
      .where(and(eq(projects.tenantId, ctx.tenantId), isNotNull(projects.deletedAt)));

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let items: any[] = [];
    if (type) {
      if (type === 'contact') items = await contactQuery.orderBy(desc(contacts.deletedAt)).limit(200);
      else if (type === 'deal') items = await dealQuery.orderBy(desc(deals.deletedAt)).limit(200);
      else if (type === 'task') items = await taskQuery.orderBy(desc(tasks.deletedAt)).limit(200);
      else if (type === 'company') items = await companyQuery.orderBy(desc(companies.deletedAt)).limit(200);
      else if (type === 'lead') items = await leadQuery.orderBy(desc(leads.deletedAt)).limit(200);
      else if (type === 'project') items = await projectQuery.orderBy(desc(projects.deletedAt)).limit(200);
    } else {
      const results = await Promise.all([
        contactQuery.limit(100),
        dealQuery.limit(100),
        taskQuery.limit(100),
        companyQuery.limit(100),
        leadQuery.limit(100),
        projectQuery.limit(100),
      ]);
      items = results.flat().sort((a, b) => 
        new Date(b.deleted_at!).getTime() - new Date(a.deleted_at!).getTime()
      );
    }

    const now = Date.now();
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withExpiry = items.map((item: any) => ({
      ...item,
      days_remaining: Math.max(0, 30 - Math.floor((now - new Date(item.deleted_at).getTime()) / 86400000)),
    }));

    return NextResponse.json({ data: withExpiry, total: withExpiry.length });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function PATCH(req: NextRequest) {
  try {
  const limited = await rateLimitMutating(req, 'trash', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id, resource_type } = await readJsonBody(req);
    if (!id || !resource_type) return NextResponse.json({ error: 'id and resource_type required' }, { status: 400 });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableMap: Record<string, any> = {
      contact: contacts, deal: deals, task: tasks, company: companies, lead: leads, project: projects,
    };
    const table = tableMap[resource_type];
    if (!table) return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 });

 

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { deletedAt: null, deletedBy: null, updatedAt: new Date() };
    if (resource_type === 'contact') updateData.isArchived = false;

    const [current] = await db
      .select({ updatedAt: table.updatedAt })
      .from(table)
      .where(and(eq(table.id, id), eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt)))
      .limit(1);

    // Row not in trash at all → 404
    if (!current) return NextResponse.json({ error: 'Not found in trash' }, { status: 404 });

    const guard = concurrencyGuard(table, current.updatedAt);
    const conditions = [eq(table.id, id), eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt)];
    if (guard) conditions.push(guard);

    const [row] = await db
      .update(table)
      .set(updateData)
      .where(and(...conditions))
      .returning({ id: table.id });

    // Row was in trash but update returned 0 rows → stale write (concurrent modification)
    if (!row) return NextResponse.json({ error: 'Stale data — this record was modified by another user. Please refresh and retry.' }, { status: 409 });
    // Re-increment the tenant counter for the restored resource
    if (resource_type === 'contact') {
      await db.update(tenants)
        .set({ currentContacts: sql`${tenants.currentContacts} + 1` })
        .where(eq(tenants.id, ctx.tenantId));
    } else if (resource_type === 'deal') {
      await db.update(tenants)
        .set({ currentDeals: sql`${tenants.currentDeals} + 1` })
        .where(eq(tenants.id, ctx.tenantId));
    }

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:`restore`, entityType: resource_type, entityId: id });
    return NextResponse.json({ ok: true, message: `${resource_type} restored successfully` });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function DELETE(req: NextRequest) {
  try {
  const limited = await rateLimitMutating(req, 'trash', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required to permanently delete' }, { status: 403 });

    const { id, resource_type, purge_all } = await readJsonBody(req);

    if (purge_all) {
      const result = await db.execute(sql`SELECT public.purge_trash() as count`);
      return NextResponse.json({ ok: true, purged: (result.rows[0] as Record<string, unknown>)?.count as number ?? 0 });
    }

    if (!id || !resource_type) return NextResponse.json({ error: 'id and resource_type required' }, { status: 400 });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableMap: Record<string, any> = {
      contact: contacts, deal: deals, task: tasks, company: companies, lead: leads, project: projects,
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
  } catch (err: any) { return apiError(err); }
}

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { projects, leads, contacts, companies, deals } from '@/drizzle/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getLinkedRecords, linkRecords, unlinkRecords, RecordLinkError } from '@/lib/record-links';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertProject(tenantId: string, id: string) {
  const [p] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId), isNull(projects.deletedAt)))
    .limit(1);
  return p;
}

// GET /api/tenant/projects/:id/related — every lead / contact / company / deal
// (and anything else) linked to this project, hydrated with a display label so
// the project page can show "everything for this project in one place" (WF-05).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = (await params).id;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    if (!(await assertProject(ctx.tenantId, id))) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const links = await getLinkedRecords(ctx.tenantId, 'project', id);

    // Batch a label lookup per entity type so N links do not become N queries.
    const idsByType = links.reduce<Record<string, string[]>>((acc, l) => {
      (acc[l.entityType] ??= []).push(l.entityId);
      return acc;
    }, {});

    const labels = new Map<string, string>();
    const put = (type: string, rows: { id: string; label: string }[]) =>
      rows.forEach((r) => labels.set(`${type}:${r.id}`, r.label));

    if (idsByType['lead']?.length) {
      const rows = await db.select({
        id: leads.id,
        label: sql<string>`coalesce(nullif(trim(${leads.firstName} || ' ' || coalesce(${leads.lastName}, '')), ''), ${leads.email}, 'Lead')`,
      }).from(leads).where(and(eq(leads.tenantId, ctx.tenantId), inArray(leads.id, idsByType['lead'])));
      put('lead', rows);
    }
    if (idsByType['contact']?.length) {
      const rows = await db.select({
        id: contacts.id,
        label: sql<string>`coalesce(nullif(trim(${contacts.firstName} || ' ' || coalesce(${contacts.lastName}, '')), ''), 'Contact')`,
      }).from(contacts).where(and(eq(contacts.tenantId, ctx.tenantId), inArray(contacts.id, idsByType['contact'])));
      put('contact', rows);
    }
    if (idsByType['company']?.length) {
      const rows = await db.select({ id: companies.id, label: companies.name })
        .from(companies).where(and(eq(companies.tenantId, ctx.tenantId), inArray(companies.id, idsByType['company'])));
      put('company', rows.map((r) => ({ id: r.id, label: r.label ?? 'Company' })));
    }
    if (idsByType['deal']?.length) {
      const rows = await db.select({ id: deals.id, label: deals.title })
        .from(deals).where(and(eq(deals.tenantId, ctx.tenantId), inArray(deals.id, idsByType['deal'])));
      put('deal', rows.map((r) => ({ id: r.id, label: r.label ?? 'Deal' })));
    }

    const data = links.map((l) => ({
      linkId: l.linkId,
      relation: l.relation,
      entityType: l.entityType,
      entityId: l.entityId,
      label: labels.get(`${l.entityType}:${l.entityId}`) ?? `${l.entityType} ${l.entityId.slice(0, 8)}`,
    }));

    return NextResponse.json({ data });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err instanceof RecordLinkError) return NextResponse.json({ error: err.message }, { status: 400 });
    return apiError(err);
  }
}

// POST /api/tenant/projects/:id/related — link a record to this project.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(req, 'projects', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = (await params).id;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    if (!(await assertProject(ctx.tenantId, id))) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = await req.json();
    const entityType = body?.entityType;
    const entityId = body?.entityId;
    if (!entityType || !entityId) {
      return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 });
    }

    const row = await linkRecords({
      tenantId: ctx.tenantId,
      fromType: 'project',
      fromId: id,
      toType: entityType,
      toId: entityId,
      relation: body?.relation ?? 'related',
      note: body?.note ?? null,
      userId: ctx.userId,
    });

    return NextResponse.json({ data: row }, { status: 201 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err instanceof RecordLinkError) return NextResponse.json({ error: err.message }, { status: 400 });
    return apiError(err);
  }
}

// DELETE /api/tenant/projects/:id/related?linkId=... — unlink a record.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(req, 'projects', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = (await params).id;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });

    const linkId = new URL(req.url).searchParams.get('linkId');
    if (!linkId) return NextResponse.json({ error: 'linkId query parameter is required' }, { status: 400 });

    const removed = await unlinkRecords(ctx.tenantId, linkId, ctx.userId);
    if (!removed) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

    return NextResponse.json({ data: { linkId, removed: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err instanceof RecordLinkError) return NextResponse.json({ error: err.message }, { status: 400 });
    return apiError(err);
  }
}

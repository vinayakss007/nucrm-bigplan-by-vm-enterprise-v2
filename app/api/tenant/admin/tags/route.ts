/**
 * Tags Manager (admin only)
 *
 *   GET  /api/tenant/admin/tags
 *        → list of unique tags across leads/contacts/companies with per-resource counts
 *
 *   POST /api/tenant/admin/tags
 *        body: { action: 'rename' | 'merge' | 'delete', tag?, new_tag?, tags?: string[] }
 *
 * Tags are stored on three columns: leads.tags, contacts.tags, companies.tags
 * (all text[]). Deals store tags inside metadata.tags[] and are out of scope for
 * this manager (no native column).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

type Counts = { leads: number; contacts: number; companies: number; total: number };

async function aggregateTags(tenantId: string): Promise<Array<{ tag: string } & Counts>> {
  // Aggregate via raw SQL — fast, single round-trip per table.
  const rows = await db.execute<{ tag: string; resource: string; count: number }>(sql`
    SELECT tag, resource, count::int FROM (
      SELECT unnest(tags) AS tag, 'leads'     AS resource, count(*) AS count
        FROM leads
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND array_length(tags,1) > 0
        GROUP BY 1, 2
      UNION ALL
      SELECT unnest(tags) AS tag, 'contacts'  AS resource, count(*) AS count
        FROM contacts
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND array_length(tags,1) > 0
        GROUP BY 1, 2
      UNION ALL
      SELECT unnest(tags) AS tag, 'companies' AS resource, count(*) AS count
        FROM companies
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND array_length(tags,1) > 0
        GROUP BY 1, 2
    ) t
    ORDER BY tag;
  `);

  const list = rows.rows ?? rows;
  const map = new Map<string, Counts>();
  for (const r of (list as { tag: string; resource: string; count: number }[])) {
    const key = r.tag as string;
    const cur = map.get(key) ?? { leads: 0, contacts: 0, companies: 0, total: 0 };
    if (r.resource === 'leads')     cur.leads     = Number(r.count);
    if (r.resource === 'contacts')  cur.contacts  = Number(r.count);
    if (r.resource === 'companies') cur.companies = Number(r.count);
    cur.total = cur.leads + cur.contacts + cur.companies;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .map(([tag, c]) => ({ tag, ...c }))
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const tags = await aggregateTags(ctx.tenantId);
    return NextResponse.json({ tags, total: tags.length });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

async function renameAcrossTables(tenantId: string, fromTag: string, toTag: string) {
  // Use array_agg(DISTINCT) on unnest(array_replace(...)) to dedupe automatically.
  const c1 = await db.execute<{ updated: number }>(sql`
    UPDATE leads SET tags = ARRAY(SELECT DISTINCT unnest(array_replace(tags, ${fromTag}, ${toTag}))), updated_at = now()
      WHERE tenant_id = ${tenantId} AND ${fromTag} = ANY(tags) AND deleted_at IS NULL
  `);
  const c2 = await db.execute<{ updated: number }>(sql`
    UPDATE contacts SET tags = ARRAY(SELECT DISTINCT unnest(array_replace(tags, ${fromTag}, ${toTag}))), updated_at = now()
      WHERE tenant_id = ${tenantId} AND ${fromTag} = ANY(tags) AND deleted_at IS NULL
  `);
  const c3 = await db.execute<{ updated: number }>(sql`
    UPDATE companies SET tags = ARRAY(SELECT DISTINCT unnest(array_replace(tags, ${fromTag}, ${toTag}))), updated_at = now()
      WHERE tenant_id = ${tenantId} AND ${fromTag} = ANY(tags) AND deleted_at IS NULL
  `);
  return {
    leads:     c1.rowCount ?? 0,
    contacts:  c2.rowCount ?? 0,
    companies: c3.rowCount ?? 0,
  };
}

async function deleteAcrossTables(tenantId: string, tag: string) {
  const c1 = await db.execute(sql`
    UPDATE leads     SET tags = array_remove(tags, ${tag}), updated_at = now()
      WHERE tenant_id = ${tenantId} AND ${tag} = ANY(tags) AND deleted_at IS NULL
  `);
  const c2 = await db.execute(sql`
    UPDATE contacts  SET tags = array_remove(tags, ${tag}), updated_at = now()
      WHERE tenant_id = ${tenantId} AND ${tag} = ANY(tags) AND deleted_at IS NULL
  `);
  const c3 = await db.execute(sql`
    UPDATE companies SET tags = array_remove(tags, ${tag}), updated_at = now()
      WHERE tenant_id = ${tenantId} AND ${tag} = ANY(tags) AND deleted_at IS NULL
  `);
  return {
    leads:     c1.rowCount ?? 0,
    contacts:  c2.rowCount ?? 0,
    companies: c3.rowCount ?? 0,
  };
}

const TAG_RE = /^[\w \-./&]{1,40}$/;

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireAuth>>;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const action = body.action;

    if (action === 'rename') {
      const fromTag = String(body.tag ?? '').trim();
      const toTag = String(body.new_tag ?? '').trim();
      if (!fromTag || !toTag) return NextResponse.json({ error: 'tag and new_tag required' }, { status: 400 });
      if (fromTag === toTag) return NextResponse.json({ error: 'old and new must differ' }, { status: 400 });
      if (!TAG_RE.test(toTag)) return NextResponse.json({ error: 'new_tag invalid (alphanumeric, dash, dot, slash, ampersand, space; max 40 chars)' }, { status: 400 });
      const counts = await renameAcrossTables(ctx.tenantId, fromTag, toTag);
      const total = counts.leads + counts.contacts + counts.companies;
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'tag_rename', entityType: 'tag',
        newData: { from: fromTag, to: toTag, counts, total } });
      return NextResponse.json({ ok: true, counts, total });
    }

    if (action === 'merge') {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sources: string[] = Array.isArray(body.tags) ? body.tags.map((s: any) => String(s).trim()).filter(Boolean) : [];
      const target = String(body.new_tag ?? '').trim();
      if (sources.length < 2) return NextResponse.json({ error: 'pick at least 2 source tags' }, { status: 400 });
      if (!target) return NextResponse.json({ error: 'new_tag (target) required' }, { status: 400 });
      if (!TAG_RE.test(target)) return NextResponse.json({ error: 'new_tag invalid' }, { status: 400 });

      const totalCounts = { leads: 0, contacts: 0, companies: 0 };
      for (const src of sources) {
        if (src === target) continue;
        const c = await renameAcrossTables(ctx.tenantId, src, target);
        totalCounts.leads += c.leads; totalCounts.contacts += c.contacts; totalCounts.companies += c.companies;
      }
      const total = totalCounts.leads + totalCounts.contacts + totalCounts.companies;
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'tag_merge', entityType: 'tag',
        newData: { sources, target, counts: totalCounts, total } });
      return NextResponse.json({ ok: true, counts: totalCounts, total });
    }

    if (action === 'delete') {
      const tag = String(body.tag ?? '').trim();
      if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
      const counts = await deleteAcrossTables(ctx.tenantId, tag);
      const total = counts.leads + counts.contacts + counts.companies;
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'tag_delete', entityType: 'tag',
        newData: { tag, counts, total } });
      return NextResponse.json({ ok: true, counts, total });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tags POST]', err);
    return apiError(err);
  }
}

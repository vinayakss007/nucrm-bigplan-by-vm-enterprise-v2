/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Bulk Company Operations
 * POST /api/tenant/companies/bulk
 * Body: { action, company_ids?, payload?, selectAll?, filters? }
 * Actions: assign, status, delete, tag
 * When selectAll=true, company_ids is optional; companies are resolved from filters.
 */
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { companies, tenantMembers, segments, segmentMembers } from '@/drizzle/schema';
import { eq, and, sql, inArray, or, ilike, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { enforceFieldWrite } from '@/lib/rbac/enforce';

const MAX_BULK = 500;

export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'bulk', 'post');
  if (limited) return limited;
  
  
  let ctx!: AuthContext;
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    ctx = auth;

    const body = await readJsonBody(req);
    const { action, payload = {} } = body;
    const selectAll = body.selectAll === true;
    const filters = body.filters as { q?: string } | undefined;

    let company_ids: string[] = body.company_ids ?? [];

    if (selectAll) {
      const whereConditions = [
        eq(companies.tenantId, ctx.tenantId),
        sql`${companies.deletedAt} IS NULL`,
      ];
      if (filters?.q) {
        whereConditions.push(or(
          ilike(companies.name, `%${escapeLike(filters.q)}%`),
        )!);
      }
      const matched = await db.select({ id: companies.id }).from(companies).where(and(...whereConditions));
      company_ids = matched.map(r => r.id);
      if (!company_ids.length) return NextResponse.json({ error: 'No companies match the provided filters' }, { status: 404 });
      if (company_ids.length > MAX_BULK) return NextResponse.json({ error: `Max ${MAX_BULK} companies per bulk operation (matched ${company_ids.length})` }, { status: 400 });
    } else {
      if (!Array.isArray(company_ids) || !company_ids.length)
        return NextResponse.json({ error: 'company_ids array required' }, { status: 400 });
      if (company_ids.length > MAX_BULK)
        return NextResponse.json({ error: `Max ${MAX_BULK} companies per bulk operation` }, { status: 400 });
    }

    // Validate all IDs belong to this tenant
    const valid = await db
      .select({ id: companies.id })
      .from(companies)
      .where(
        and(
          inArray(companies.id, company_ids),
          eq(companies.tenantId, ctx.tenantId),
          sql`${companies.deletedAt} IS NULL`
        )
      );
    
    const validIds = valid.map(r => r.id);
    // `restore` is the one action whose target set is NOT `validIds`: trashed rows
    // never survive the live-only validation above. Re-resolve it in the case
    // instead of bailing here (#3154; leads/bulk:70, deals/bulk:91).
    if (!validIds.length && action !== 'restore')
      return NextResponse.json({ error: 'No valid companies found' }, { status: 404 });

    let affected = 0;

    // #2618 — same doctrine as the deals bulk gate (#2641): the action writes
    // the column that IS the action, so a field_permissions restriction on it
    // must reject (403) rather than perform a stripped, meaningless update.
    const BULK_WATCHED_FIELDS: Record<string, string[]> = {
      assign: ['assigned_to'],
      status: ['status'],
      tag: ['tags'],
      update_field: ['custom_fields'],
    };
    const watched = BULK_WATCHED_FIELDS[action as string];
    if (watched) {
      const { stripped } = await enforceFieldWrite(
        ctx, 'companies', Object.fromEntries(watched.map((f) => [f, true])),
      );
      if (stripped.length > 0) {
        return NextResponse.json(
          { error: `field_permissions restricts: ${stripped.join(', ')}` },
          { status: 403 },
        );
      }
    }

    switch (action) {
      case 'assign': {
        const deny = requirePerm(ctx, 'companies.assign');
        if (deny) return deny;
        if (!payload.assigned_to) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });
        
        // Verify assignee is a member
        const [member] = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.userId, payload.assigned_to),
              eq(tenantMembers.tenantId, ctx.tenantId),
              eq(tenantMembers.status, 'active')
            )
          )
          .limit(1);
        
        if (!member) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        
        const res = await db
          .update(companies)
          .set({
            // #2960: write the first-class #1084 columns. The old code put the
            // assignee in metadata JSON, which no reader consults and which the
            // owner-scope filters and idx_companies_assigned cannot see.
            assignedTo: payload.assigned_to,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, validIds),
              eq(companies.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'status': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;
        const STATUSES = ['active','inactive','archived'];
        if (!STATUSES.includes(payload.status))
          return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        
        const res = await db
          .update(companies)
          .set({
            // #2960: companies.status is a first-class notNull column (#1084);
            // the metadata JSON it used to write is read by nothing.
            status: payload.status,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, validIds),
              eq(companies.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'companies.delete');
        if (deny) return deny;
        
        const res = await db
          .update(companies)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            isCustomer: false,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, validIds),
              eq(companies.tenantId, ctx.tenantId),
              sql`${companies.deletedAt} IS NULL`
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'tag': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;
        const tag = payload.tag?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        
        const res = await db
          .update(companies)
          .set({
            tags: sql`array_append(${companies.tags}, ${tag})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, validIds),
              eq(companies.tenantId, ctx.tenantId),
              sql`NOT (${tag} = ANY(${companies.tags}))`
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'update_field': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;
        const fieldKey = payload['field_key'] as string | undefined;
        const fieldValue = payload['field_value'];
        if (!fieldKey) return NextResponse.json({ error: 'field_key required' }, { status: 400 });
        
        const res = await db
          .update(companies)
          .set({
            customFields: sql`jsonb_set(COALESCE(${companies.customFields}, '{}'::jsonb), ${'{"' + fieldKey + '"}'}::text[], ${JSON.stringify(fieldValue)}::jsonb, true)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, validIds),
              eq(companies.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'archive': {
        const deny = requirePerm(ctx, 'companies.delete');
        if (deny) return deny;
        const res = await db
          .update(companies)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, validIds),
              eq(companies.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'restore': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;

        // #3154 — over `validIds` this wrote `deletedAt: null` onto rows that already
        // had it and reported them as restored. Re-resolve the caller's ids against the
        // trashed set, on this route's own scope — tenant + tombstone, because
        // `companies.view_all` is defined and enforced nowhere, deliberately (#2597;
        // trash/route.ts:122, notes/bulk/route.ts:33 say the same for their entity).
        const restorable = await db
          .select({ id: companies.id })
          .from(companies)
          .where(
            and(
              inArray(companies.id, company_ids),
              eq(companies.tenantId, ctx.tenantId),
              sql`${companies.deletedAt} IS NOT NULL`
            )
          );
        const restorableIds = restorable.map(r => r.id);
        if (!restorableIds.length)
          return NextResponse.json({ error: 'No deleted companies found to restore' }, { status: 404 });

        const res = await db
          .update(companies)
          .set({
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(companies.id, restorableIds),
              eq(companies.tenantId, ctx.tenantId),
              sql`${companies.deletedAt} IS NOT NULL`
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'add_to_segment': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;
        const segId = payload['segment_id'] as string | undefined;
        if (!segId) return NextResponse.json({ error: 'segment_id required' }, { status: 400 });
        const [seg] = await db.select({ id: segments.id }).from(segments)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, ctx.tenantId), isNull(segments.deletedAt)))
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
      action: `bulk_${action}`, entityType: 'company',
      newData: { count: affected, company_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant/companies bulk POST', requestMethod: 'POST' });
    await logError({ error: err, context: 'companies/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
});


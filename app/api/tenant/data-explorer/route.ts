/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql, type SQL } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { ownerScopeAlias, ownerScopeSql } from '@/lib/api/owner-scope';
import { escapeLike } from '@/lib/api/sanitize-like';
import { logError } from '@/lib/errors-server';
import { parsePageLimit } from '@/lib/api/query-params';

const ENTITY_CONFIG: Record<string, {
  label: string;
  searchFields: string[];
  sortFields: string[];
  defaultSort: string;
  alias: string;
  viewAll: string | null;
}> = {
  contacts: {
    label: 'Contacts',
    searchFields: ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source'],
    sortFields: ['created_at', 'updated_at', 'first_name', 'last_name', 'email'],
    defaultSort: 'created_at',
    alias: 'c',
    viewAll: 'contacts.view_all',
  },
  leads: {
    label: 'Leads',
    searchFields: ['first_name', 'last_name', 'email', 'phone', 'lead_status'],
    sortFields: ['created_at', 'first_name', 'last_name', 'email'],
    defaultSort: 'created_at',
    alias: 'l',
    viewAll: 'leads.view_all',
  },
  deals: {
    label: 'Deals',
    searchFields: ['title'],
    sortFields: ['created_at', 'updated_at', 'title', 'amount'],
    defaultSort: 'created_at',
    alias: 'd',
    viewAll: 'deals.view_all',
  },
  // #2704 — `companies.view_all` is defined (lib/permissions/definitions.ts:43)
  // and enforced nowhere: neither companies/route.ts nor companies/[id]/route.ts
  // references it. Narrowing only this tool would invent an owner rule the rest of
  // the entity does not have, so companies stay tenant-scoped until that decision
  // is made (#2597).
  companies: {
    label: 'Companies',
    searchFields: ['name', 'industry', 'website', 'phone'],
    sortFields: ['created_at', 'updated_at', 'name'],
    defaultSort: 'created_at',
    alias: 'co',
    viewAll: null,
  },
  tasks: {
    label: 'Tasks',
    searchFields: ['title', 'description'],
    sortFields: ['created_at', 'updated_at', 'title', 'due_date'],
    defaultSort: 'created_at',
    alias: 't',
    viewAll: 'tasks.view_all',
  },
};

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'contacts';
    const q = searchParams.get('q')?.trim() || '';
    const { page, limit, offset } = parsePageLimit(searchParams, { defaultLimit: 50, maxLimit: 200 });
    const sort = searchParams.get('sort') || ENTITY_CONFIG[type]?.defaultSort || 'created_at';
    const order = (searchParams.get('order') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const field = searchParams.get('field');
    const fieldValue = searchParams.get('value');

    const config = ENTITY_CONFIG[type];
    if (!config) {
      return NextResponse.json({ error: `Unknown entity type: ${type}` }, { status: 400 });
    }

    const safeSort = config.sortFields.includes(sort) ? sort : config.defaultSort;

    const buildConditions = (tableAlias: string) => {
      const conds = [sql`${sql.identifier(tableAlias)}.tenant_id = ${ctx.tenantId}`];
      conds.push(sql`${sql.identifier(tableAlias)}.deleted_at IS NULL`);
      // #2704 — the owner narrowing goes here, in the one place both the count
      // query and all five data branches read from, because every entity this
      // tool serves answers 404 on its own record path unless the row is
      // `assigned_to` or `created_by` the caller (#2671, #2673, #2674, #2692).
      // Tenant alone was a tenant-wide CRUD panel for a `sales_rep`.
      const mine = config.viewAll
        ? ownerScopeAlias(ctx, config.viewAll, tableAlias)
        : undefined;
      if (mine) conds.push(mine);
      if (q) {
        // #2751 — the pattern is a bound parameter, so Postgres still reads `%`
        // and `_` inside it as wildcards: `q=%` matched every non-null value of
        // every search field and the box looked like it filtered nothing. The
        // admin twin of this panel already escapes
        // (`app/api/superadmin/data-explorer/route.ts:224`).
        const qPattern = `%${escapeLike(q)}%`;
        const searchConds = config.searchFields.map(f =>
          sql`${sql.identifier(tableAlias)}.${sql.identifier(f)} ILIKE ${qPattern}`
        );
        conds.push(sql`(${sql.join(searchConds, sql` OR `)})`);
      }
      if (field && fieldValue && config.searchFields.includes(field)) {
        conds.push(sql`${sql.identifier(tableAlias)}.${sql.identifier(field)} ILIKE ${`%${escapeLike(fieldValue)}%`}`);
      }
      return conds;
    };

    const where = sql`WHERE ${sql.join(buildConditions(config.alias), sql` AND `)}`;

    const orderSql = order === 'ASC' ? sql`ASC` : sql`DESC`;
    let dataRes;
    const countQuery = sql`SELECT count(*) FROM ${sql.identifier(type)} ${sql.identifier(config.alias)} ${where}`;
    const totalRes = await db.execute(countQuery);
    const totalRows = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

    switch (type) {
      case 'contacts': {
        dataRes = await db.execute(sql`
          SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                 c.lead_status, c.lead_source, c.job_title, c.created_at, c.updated_at,
                 co.name as company_name
          FROM contacts c
          LEFT JOIN companies co ON c.company_id = co.id
          ${where}
          ORDER BY ${sql.identifier('c')}.${sql.identifier(safeSort)} ${orderSql}
          LIMIT ${limit} OFFSET ${offset}
        `);
        break;
      }
      case 'leads': {
        dataRes = await db.execute(sql`
          SELECT l.id, l.first_name, l.last_name, l.email, l.phone,
                 l.lead_status, l.lead_source, l.score, l.created_at, l.updated_at
          FROM leads l
          ${where}
          ORDER BY ${sql.identifier('l')}.${sql.identifier(safeSort)} ${orderSql}
          LIMIT ${limit} OFFSET ${offset}
        `);
        break;
      }
      case 'deals': {
        dataRes = await db.execute(sql`
          SELECT d.id, d.title, d.amount, d.stage_id, d.close_date,
                 d.created_at, d.updated_at,
                 c.first_name || ' ' || c.last_name as contact_name
          FROM deals d
          LEFT JOIN contacts c ON d.contact_id = c.id
          ${where}
          ORDER BY ${sql.identifier('d')}.${sql.identifier(safeSort === 'name' ? 'title' : safeSort)} ${orderSql}
          LIMIT ${limit} OFFSET ${offset}
        `);
        break;
      }
      case 'companies': {
        dataRes = await db.execute(sql`
          SELECT co.id, co.name, co.industry, co.website, co.phone,
                 co.created_at, co.updated_at,
                 (SELECT count(*) FROM contacts cc
                    WHERE cc.company_id = co.id AND cc.deleted_at IS NULL
                      AND cc.tenant_id = ${ctx.tenantId}) as contact_count
          FROM companies co
          ${where}
          ORDER BY ${sql.identifier('co')}.${sql.identifier(safeSort)} ${orderSql}
          LIMIT ${limit} OFFSET ${offset}
        `);
        break;
      }
      case 'tasks': {
        dataRes = await db.execute(sql`
          SELECT t.id, t.title, t.description, t.status, t.priority,
                 t.due_date, t.created_at, t.updated_at
          FROM tasks t
          ${where}
          ORDER BY ${sql.identifier('t')}.${sql.identifier(safeSort)} ${orderSql}
          LIMIT ${limit} OFFSET ${offset}
        `);
        break;
      }
      default: {
        return NextResponse.json({ error: `Unknown entity type: ${type}` }, { status: 400 });
      }
    }

    return NextResponse.json({
      data: dataRes.rows,
      total: totalRows,
      page,
      limit,
      hasMore: offset + limit < totalRows,
      sort,
      order,
    });
  } catch (err) {
    await logError({ error: err, context: 'data-explorer GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

/**
 * The row rule for a verb that addresses a single row by id (#2704). PUT and
 * DELETE are gated on `${table}.edit` / `${table}.delete`, which are capability
 * checks: they say nothing about *which* rows. This is the predicate the same
 * entity's record path uses, so `PUT /data-explorer` cannot edit what
 * `PATCH /contacts/[id]` refuses. Companies carry `null` above and stay
 * tenant-only, for the reason given there.
 */
function ownerSql(ctx: AuthContext, table: string): SQL {
  const viewAll = ENTITY_CONFIG[table]?.viewAll;
  return ownerScopeSql(viewAll ? ownerScopeAlias(ctx, viewAll, table) : undefined);
}

// Accepted as text and handed to Postgres for the `::timestamptz` cast, which
// knows how to read its own output format (including the microsecond digits).
// The JS check exists only to answer 400 rather than 500: new Date() is used as
// a validity test, never as the value that reaches the query.
const editTimestampSchema = z.string().min(1).refine(
  (raw) => !Number.isNaN(new Date(raw).getTime()),
  { message: 'expectedUpdatedAt must be an ISO 8601 timestamp' },
);

const updateSchema = z.object({
  table: z.enum(['contacts', 'leads', 'deals', 'companies', 'tasks']),
  id: z.string().min(1),
  field: z.string().min(1),
  value: z.any(),
  // Optimistic concurrency (#680): when supplied, the inline edit only applies
  // if the row's updated_at still matches. Opt-in — omitting it keeps the prior
  // last-write-wins behaviour.
  //
  // Parsed with new Date() rather than z.string().datetime() because the stamp
  // this guard exists to echo back does not come from JSON: the list view reads
  // updated_at through a raw db.execute(), and node-postgres hands timestamptz
  // back as Postgres' own text — "2026-09-29 09:52:19.079633+00", space
  // separated, microsecond, +00 — which datetime() rejected with a 400. So the
  // only stamp a client could obtain from this feature was one this feature
  // refused to accept, and the guard could never be exercised. An
  // unparseable value is still a 400, never a silently skipped check.
  expectedUpdatedAt: editTimestampSchema.optional(),
});

// Explicit per-table allowlist of editable columns.
// Prevents writes to system columns (id, tenant_id, created_at, deleted_at, ...)
// even if upstream validation changes.
// Field-level authorization (#1161): sensitive business fields (money,
// ownership links, scoring) are admin-only; regular members get the rest.
const ADMIN_ONLY_FIELDS: Record<string, Set<string>> = {
  contacts: new Set(['company_id']),
  leads: new Set(['score', 'lead_source']),
  deals: new Set(['amount', 'stage_id', 'close_date']),
  companies: new Set([]),
  tasks: new Set(['priority']),
};

const EDITABLE_FIELDS: Record<string, string[]> = {
  contacts: ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source', 'job_title', 'company_id'],
  leads: ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source', 'score'],
  deals: ['title', 'amount', 'stage_id', 'close_date'],
  companies: ['name', 'industry', 'website', 'phone'],
  tasks: ['title', 'description', 'status', 'priority', 'due_date'],
};

export const PUT = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(req);
    const validated = validateBody(updateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { table, id, field, value, expectedUpdatedAt } = validated.data;

    // #1126: authenticated is not enough — updating a record requires the
    // per-entity edit permission (e.g. deals.edit), not just a valid session.
    const editDeny = requirePerm(ctx, `${table}.edit`);
    if (editDeny) return editDeny;

    const allowedFields = EDITABLE_FIELDS[table] || [];
    if (!allowedFields.includes(field)) {
      return NextResponse.json({ error: `Field '${field}' is not editable` }, { status: 400 });
    }
    // Field-level authz: admin-only fields require an admin (#1161)
    if (!ctx.isAdmin && ADMIN_ONLY_FIELDS[table]?.has(field)) {
      return NextResponse.json(
        { error: `Field '${field}' requires admin access` },
        { status: 403 },
      );
    }
    const safeField = field.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeField || safeField !== field) {
      return NextResponse.json({ error: 'Invalid field name' }, { status: 400 });
    }

    // Optimistic concurrency guard: truncate both sides to millisecond
    // precision so the comparison survives the JS/pg round-trip (pg keeps
    // microseconds, JS Date only ms).
    const versionCond = expectedUpdatedAt
      ? sql` AND date_trunc('millisecond', updated_at::timestamptz) = date_trunc('millisecond', ${expectedUpdatedAt}::timestamptz)`
      : sql``;

    const result = await db.execute(sql`
      UPDATE ${sql.identifier(table)} SET ${sql.identifier(safeField)} = ${value}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}${ownerSql(ctx, table)}${versionCond}
      RETURNING id, ${sql.identifier(safeField)}
    `);

    if (result.rows.length === 0) {
      // With a version condition, a 0-row result may mean the row moved on
      // rather than not existing — distinguish so the client can refresh.
      if (expectedUpdatedAt) {
        const [exists] = (await db.execute(sql`
          SELECT 1 FROM ${sql.identifier(table)} WHERE id = ${id} AND tenant_id = ${ctx.tenantId}${ownerSql(ctx, table)} LIMIT 1
        `)).rows;
        if (exists) {
          return NextResponse.json(
            { error: 'Stale data — this record was modified by another user. Please refresh and retry.' },
            { status: 409 },
          );
        }
      }
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    await logError({ error: err, context: 'data-explorer PUT', requestMethod: 'PUT' });
    return apiError(err);
  }
});

const deleteSchema = z.object({
  table: z.enum(['contacts', 'leads', 'deals', 'companies', 'tasks']),
  id: z.string().min(1),
});

export const DELETE = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'reports', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(req);
    const validated = validateBody(deleteSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { table, id } = validated.data;

    // #1126: deleting a record requires the per-entity delete permission
    // (e.g. deals.delete), not just a valid session.
    const deleteDeny = requirePerm(ctx, `${table}.delete`);
    if (deleteDeny) return deleteDeny;

    const result = await db.execute(sql`
      UPDATE ${sql.identifier(table)} SET deleted_at = NOW() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}${ownerSql(ctx, table)} RETURNING id
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    await logError({ error: err, context: 'data-explorer DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

const ENTITY_CONFIG: Record<string, { label: string; searchFields: string[]; sortFields: string[]; defaultSort: string }> = {
  contacts: {
    label: 'Contacts',
    searchFields: ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source'],
    sortFields: ['created_at', 'updated_at', 'first_name', 'last_name', 'email'],
    defaultSort: 'created_at',
  },
  leads: {
    label: 'Leads',
    searchFields: ['first_name', 'last_name', 'email', 'phone', 'lead_status'],
    sortFields: ['created_at', 'first_name', 'last_name', 'email'],
    defaultSort: 'created_at',
  },
  deals: {
    label: 'Deals',
    searchFields: ['title'],
    sortFields: ['created_at', 'updated_at', 'title', 'amount'],
    defaultSort: 'created_at',
  },
  companies: {
    label: 'Companies',
    searchFields: ['name', 'industry', 'website', 'phone'],
    sortFields: ['created_at', 'updated_at', 'name'],
    defaultSort: 'created_at',
  },
  tasks: {
    label: 'Tasks',
    searchFields: ['title', 'description'],
    sortFields: ['created_at', 'updated_at', 'title', 'due_date'],
    defaultSort: 'created_at',
  },
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'contacts';
    const q = searchParams.get('q')?.trim() || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const offset = (page - 1) * limit;
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
      if (q) {
        const qPattern = `%${q}%`;
        const searchConds = config.searchFields.map(f =>
          sql`${sql.identifier(tableAlias)}.${sql.identifier(f)} ILIKE ${qPattern}`
        );
        conds.push(sql`(${sql.join(searchConds, sql` OR `)})`);
      }
      if (field && fieldValue && config.searchFields.includes(field)) {
        conds.push(sql`${sql.identifier(tableAlias)}.${sql.identifier(field)} ILIKE ${`%${fieldValue}%`}`);
      }
      return conds;
    };

    const where = sql`WHERE ${sql.join(buildConditions(type === 'deals' ? 'd' : type === 'companies' ? 'co' : type === 'tasks' ? 't' : type === 'leads' ? 'l' : 'c'), sql` AND `)}`;

    let dataRes;
    const countQuery = sql`SELECT count(*) FROM ${sql.identifier(type === 'deals' ? 'deals' : type === 'companies' ? 'companies' : type === 'tasks' ? 'tasks' : type === 'leads' ? 'leads' : 'contacts')} ${type === 'deals' ? sql`d` : type === 'companies' ? sql`co` : type === 'tasks' ? sql`t` : type === 'leads' ? sql`l` : sql`c`} ${where}`;
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
          ORDER BY ${sql.identifier('c')}.${sql.identifier(safeSort)} ${sql.raw(order)}
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
          ORDER BY ${sql.identifier('l')}.${sql.identifier(safeSort)} ${sql.raw(order)}
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
          ORDER BY ${sql.identifier('d')}.${sql.identifier(safeSort === 'name' ? 'title' : safeSort)} ${sql.raw(order)}
          LIMIT ${limit} OFFSET ${offset}
        `);
        break;
      }
      case 'companies': {
        dataRes = await db.execute(sql`
          SELECT co.id, co.name, co.industry, co.website, co.phone,
                 co.created_at, co.updated_at,
                 (SELECT count(*) FROM contacts WHERE company_id = co.id AND deleted_at IS NULL) as contact_count
          FROM companies co
          ${where}
          ORDER BY ${sql.identifier('co')}.${sql.identifier(safeSort)} ${sql.raw(order)}
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
          ORDER BY ${sql.identifier('t')}.${sql.identifier(safeSort)} ${sql.raw(order)}
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
    console.error('[data-explorer GET]', err);
    return apiError(err);
  }
}

const updateSchema = z.object({
  table: z.enum(['contacts', 'leads', 'deals', 'companies', 'tasks']),
  id: z.string().min(1),
  field: z.string().min(1),
  value: z.any(),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(req);
    const validated = validateBody(updateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { table, id, field, value } = validated.data;

    const safeField = field.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeField) {
      return NextResponse.json({ error: 'Invalid field name' }, { status: 400 });
    }

    const result = await db.execute(sql`
      UPDATE ${sql.identifier(table)} SET ${sql.identifier(safeField)} = ${value}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      RETURNING id, ${sql.identifier(safeField)}
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[data-explorer PUT]', err);
    return apiError(err);
  }
}

const deleteSchema = z.object({
  table: z.enum(['contacts', 'leads', 'deals', 'companies', 'tasks']),
  id: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  try {
  const limited = await rateLimitMutating(req, 'reports', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(req);
    const validated = validateBody(deleteSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { table, id } = validated.data;

    const result = await db.execute(sql`
      UPDATE ${sql.identifier(table)} SET deleted_at = NOW() WHERE id = ${id} AND tenant_id = ${ctx.tenantId} RETURNING id
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error('[data-explorer DELETE]', err);
    return apiError(err);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';

/**
 * Superadmin Cross-Tenant Data Search & Explorer
 * 
 * GET /api/superadmin/data-explorer
 *   ?q=searchTerm           — global search across all tenants
 *   ?type=contacts|leads|deals|companies|users|tenants
 *   ?tenantId=xxx           — filter by specific tenant
 *   ?page=1&limit=50        — pagination
 *   ?sort=created_at&order=desc
 *   ?field=email&value=xxx  — exact field search
 */

export async function GET(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (!ctx || ctx instanceof NextResponse) {
    return ctx instanceof NextResponse ? ctx : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'summary') {
    return handleSummary(searchParams);
  }

  if (action === 'schema') {
    return handleSchemaInfo();
  }

  return handleSearch(searchParams);
}

// ── Global Search Across All Tenants ────────────────────────────────────────

async function handleSummary(searchParams: URLSearchParams) {
  try {
    const tenantId = searchParams.get('tenantId');

    if (tenantId) {
      // Summary for a specific tenant
      const res = await db.execute(sql`
        SELECT t.id, t.name, t.subdomain, t.slug, t.status, p.name as plan,
               t.created_at, t.trial_ends_at,
               u.email as owner_email, u.full_name as owner_name,
               (SELECT count(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL) as contact_count,
               (SELECT count(*) FROM leads WHERE tenant_id = t.id AND deleted_at IS NULL) as lead_count,
               (SELECT count(*) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL) as deal_count,
               (SELECT count(*) FROM companies WHERE tenant_id = t.id AND deleted_at IS NULL) as company_count,
               (SELECT count(*) FROM tasks WHERE tenant_id = t.id AND deleted_at IS NULL) as task_count,
               (SELECT count(*) FROM tenant_members WHERE tenant_id = t.id) as member_count,
               (SELECT count(*) FROM activities WHERE tenant_id = t.id) as activity_count,
               (SELECT count(*) FROM workflows WHERE tenant_id = t.id) as workflow_count,
               (SELECT COALESCE(SUM(amount), 0) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL) as total_pipeline_value
        FROM tenants t
        LEFT JOIN public.plans p ON p.id = t.plan_id
        LEFT JOIN users u ON t.owner_id = u.id
        WHERE t.id = ${tenantId}
      `);

      if (res.rows.length === 0) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }

      return NextResponse.json({ tenant: res.rows[0] });
    }

    // Platform-wide summary
    const summaryRes = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM tenants) as total_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'active') as active_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'trialing') as trialing_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'suspended') as suspended_tenants,
        (SELECT count(*) FROM users) as total_users,
        (SELECT count(*) FROM contacts WHERE deleted_at IS NULL) as total_contacts,
        (SELECT count(*) FROM leads WHERE deleted_at IS NULL) as total_leads,
        (SELECT count(*) FROM deals WHERE deleted_at IS NULL) as total_deals,
        (SELECT count(*) FROM companies WHERE deleted_at IS NULL) as total_companies,
        (SELECT count(*) FROM tasks WHERE deleted_at IS NULL) as total_tasks,
        (SELECT COALESCE(SUM(d.amount), 0) FROM deals d WHERE d.deleted_at IS NULL) as total_pipeline_value,
        (SELECT count(*) FROM tenants WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week,
        (SELECT count(*) FROM tenants WHERE created_at > NOW() - INTERVAL '30 days') as new_this_month
    `);

    return NextResponse.json({ summary: summaryRes.rows[0] });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── Schema Information ──────────────────────────────────────────────────────

async function handleSchemaInfo() {
  try {
    // Get all tables with their columns and row counts
    const tablesRes = await db.execute(sql`
      SELECT 
        t.table_name,
        (SELECT count(*) FROM information_schema.columns c 
         WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count,
        (SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = t.table_name AND column_name = 'tenant_id'
        )) as has_tenant_id,
        (SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = t.table_name AND column_name = 'deleted_at'
        )) as has_soft_delete
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `);

    const tables = tablesRes.rows as { table_name: string; column_count: number; has_tenant_id: boolean; has_soft_delete: boolean }[];
    const tenantTables = tables.filter(t => t.has_tenant_id);
    const tableDetails: { table: string; columns: unknown; totalRows: number }[] = [];

    for (const table of tenantTables.slice(0, 20)) {
      try {
        const columnsRes = await db.execute(sql`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = ${table.table_name} AND table_schema = 'public'
          ORDER BY ordinal_position
        `);

        const countResult = await db.execute(sql`SELECT count(*) FROM ${sql.identifier(table.table_name)}`);

        tableDetails.push({
          table: table.table_name,
          columns: columnsRes.rows,
          totalRows: parseInt(((countResult.rows[0] as Record<string, unknown>)?.count as string) || '0', 10),
        });
      } catch {
        // Silently skip during migration/setup when tables may not exist yet
      }
    }

    return NextResponse.json({ tables: tableDetails });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── Main Search Handler ─────────────────────────────────────────────────────

async function handleSearch(searchParams: URLSearchParams) {
  try {
    const q = searchParams.get('q')?.trim() || '';
    const type = searchParams.get('type') || 'all';
    const tenantId = searchParams.get('tenantId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const offset = (page - 1) * limit;
    const sort = searchParams.get('sort') || 'created_at';
    const order = (searchParams.get('order') || 'desc').toUpperCase();
    const field = searchParams.get('field');
    const fieldValue = searchParams.get('value');

    const allowedSortColumns = ['id', 'name', 'email', 'title', 'created_at', 'updated_at', 'amount', 'lead_status', 'lead_source', 'first_name', 'last_name', 'phone', 'company_name'];
    const safeSort = allowedSortColumns.includes(sort) ? sort : 'created_at';
    const safeOrder = order === 'ASC' ? 'ASC' : 'DESC';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any = {};
    let totalAcrossAll = 0;

    const buildConditions = (tableAlias: string, searchFields: string[]) => {
      const conds = [];
      if (q) {
        // Escape LIKE metacharacters (%, _, \) so user input is matched
        // literally. Without this, `%`/`_` act as wildcards (LIKE-injection /
        // slow full scans). Mirrors app/api/superadmin/search/route.ts.
        const qPattern = `%${escapeLike(q)}%`;
        const searchConds = searchFields.map(f => sql`${sql.identifier(tableAlias)}.${sql.identifier(f)} ILIKE ${qPattern}`);
        conds.push(sql`(${sql.join(searchConds, sql` OR `)})`);
      }
      if (tenantId) {
        conds.push(sql`${sql.identifier(tableAlias)}.${sql.identifier('tenant_id')} = ${tenantId}`);
      }
      return conds;
    };

    if (type === 'all' || type === 'tenants') {
      const conds = buildConditions('t', ['name', 'slug', 'billing_email']);
      const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

      const totalRes = await db.execute(sql`SELECT count(*) FROM tenants t ${where}`);
      const total = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

      const dataRes = await db.execute(sql`
        SELECT t.id, t.name, t.slug, t.status, p.name as plan,
               t.created_at, t.updated_at,
               u.email as owner_email,
               (SELECT count(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL) as contact_count
        FROM tenants t
        LEFT JOIN public.plans p ON p.id = t.plan_id
        LEFT JOIN users u ON t.owner_id = u.id
        ${where}
        ORDER BY ${sql.identifier('t')}.${sql.identifier(safeSort)} ${sql.raw(safeOrder)}
        LIMIT ${limit} OFFSET ${offset}
      `);

      results.tenants = { data: dataRes.rows, total, page, limit };
      totalAcrossAll += total;
    }

    if (type === 'all' || type === 'contacts') {
      const searchFields = ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source'];
      const conds = buildConditions('c', searchFields);
      conds.push(sql`c.deleted_at IS NULL`);
      if (field && fieldValue && searchFields.includes(field)) {
        conds.push(sql`${sql.identifier('c')}.${sql.identifier(field)} = ${fieldValue}`);
      }
      const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;

      const totalRes = await db.execute(sql`SELECT count(*) FROM contacts c ${where}`);
      const total = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

      const dataRes = await db.execute(sql`
        SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
               c.lead_status, c.lead_source, c.created_at, c.updated_at,
               t.name as tenant_name,
               co.name as company_name
        FROM contacts c
        JOIN tenants t ON c.tenant_id = t.id
        LEFT JOIN companies co ON c.company_id = co.id
        ${where}
        ORDER BY ${sql.identifier('c')}.${sql.identifier(safeSort)} ${sql.raw(safeOrder)}
        LIMIT ${limit} OFFSET ${offset}
      `);

      results.contacts = { data: dataRes.rows, total, page, limit };
      if (type === 'contacts') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'leads') {
      // leads are just contacts with specific lifecycle_stage or status in some systems, 
      // but in this schema they might be separate or just a filtered view.
      // Based on legacy data-explorer, it queried 'leads' table.
      const conds = buildConditions('l', ['first_name', 'last_name', 'email']);
      conds.push(sql`l.deleted_at IS NULL`);
      const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;

      const totalRes = await db.execute(sql`SELECT count(*) FROM leads l ${where}`);
      const total = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

      const dataRes = await db.execute(sql`
        SELECT l.id, l.first_name, l.last_name, l.email, l.phone,
               l.lead_status, l.created_at,
               t.name as tenant_name
        FROM leads l
        JOIN tenants t ON l.tenant_id = t.id
        ${where}
        ORDER BY ${sql.identifier('l')}.${sql.identifier(safeSort)} ${sql.raw(safeOrder)}
        LIMIT ${limit} OFFSET ${offset}
      `);

      results.leads = { data: dataRes.rows, total, page, limit };
      if (type === 'leads') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'deals') {
      const conds = buildConditions('d', ['title']);
      conds.push(sql`d.deleted_at IS NULL`);
      const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;

      const totalRes = await db.execute(sql`SELECT count(*) FROM deals d ${where}`);
      const total = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

      const dataRes = await db.execute(sql`
        SELECT d.id, d.title, d.amount, d.stage_id, d.close_date,
               d.created_at, d.updated_at,
               t.name as tenant_name,
               c.first_name || ' ' || c.last_name as contact_name
        FROM deals d
        JOIN tenants t ON d.tenant_id = t.id
        LEFT JOIN contacts c ON d.contact_id = c.id
        ${where}
        ORDER BY ${sql.identifier('d')}.${sql.identifier(safeSort === 'value' ? 'amount' : safeSort)} ${sql.raw(safeOrder)}
        LIMIT ${limit} OFFSET ${offset}
      `);

      results.deals = { data: dataRes.rows, total, page, limit };
      if (type === 'deals') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'companies') {
      const conds = buildConditions('co', ['name', 'industry', 'website']);
      conds.push(sql`co.deleted_at IS NULL`);
      const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;

      const totalRes = await db.execute(sql`SELECT count(*) FROM companies co ${where}`);
      const total = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

      const dataRes = await db.execute(sql`
        SELECT co.id, co.name, co.industry, co.website, co.phone,
               co.created_at, co.updated_at,
               t.name as tenant_name,
               (SELECT count(*) FROM contacts WHERE company_id = co.id AND deleted_at IS NULL) as contact_count
        FROM companies co
        JOIN tenants t ON co.tenant_id = t.id
        ${where}
        ORDER BY ${sql.identifier('co')}.${sql.identifier(safeSort)} ${sql.raw(safeOrder)}
        LIMIT ${limit} OFFSET ${offset}
      `);

      results.companies = { data: dataRes.rows, total, page, limit };
      if (type === 'companies') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'users') {
      const conds = buildConditions('u', ['email', 'full_name']);
      const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

      const totalRes = await db.execute(sql`SELECT count(DISTINCT u.id) FROM users u ${where}`);
      const total = parseInt(((totalRes.rows[0] as Record<string, unknown>)?.count as string) || '0', 10);

      const dataRes = await db.execute(sql`
        SELECT u.id, u.email, u.full_name, u.is_super_admin,
               u.created_at,
               tm.tenant_id, t.name as tenant_name,
               tm.role_slug as tenant_role
        FROM users u
        LEFT JOIN tenant_members tm ON tm.user_id = u.id
        LEFT JOIN tenants t ON tm.tenant_id = t.id
        ${where}
        ORDER BY ${sql.identifier('u')}.${sql.identifier(safeSort)} ${sql.raw(safeOrder)}
        LIMIT ${limit} OFFSET ${offset}
      `);

      results.users = { data: dataRes.rows, total, page, limit };
      if (type === 'users') totalAcrossAll = total;
    }

    return NextResponse.json({
      results,
      totalAcrossAll,
      query: q,
      filters: { type, tenantId, page, limit },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Superadmin Data Explorer] Search error:', err);
    return apiError(err);
  }
}

// ── Update a Record ─────────────────────────────────────────────────────────

const updateRecordSchema = z.object({
  table: z.string().min(1),
  id: z.string().min(1),
  field: z.string().min(1),
  value: z.any(),
});

const deleteRecordSchema = z.object({
  table: z.string().min(1),
  id: z.string().min(1),
  softDelete: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

// Column allowlist per table for dynamic SQL updates (Issue #683)
const ALLOWED_COLUMNS: Record<string, string[]> = {
  tenants: ['name', 'slug', 'subdomain', 'status', 'billing_email', 'plan_id', 'trial_ends_at'],
  contacts: ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source', 'company_id', 'notes'],
  leads: ['first_name', 'last_name', 'email', 'phone', 'lead_status', 'lead_source', 'notes'],
  deals: ['title', 'amount', 'stage_id', 'close_date', 'contact_id', 'company_id', 'notes', 'probability'],
  companies: ['name', 'industry', 'website', 'phone', 'address', 'notes'],
  tasks: ['title', 'description', 'due_date', 'status', 'priority', 'assigned_to'],
  users: ['full_name', 'email', 'is_super_admin'],
  roles: ['name', 'description'],
  webhooks: ['url', 'events', 'active'],
  api_keys: ['name', 'active'],
  email_templates: ['name', 'subject', 'body', 'active'],
  workflows: ['name', 'description', 'active'],
  automations: ['name', 'description', 'active', 'trigger_type'],
  forms: ['name', 'description', 'active'],
  pipelines: ['name', 'description'],
  deal_stages: ['name', 'position', 'probability'],
  tags: ['name', 'color'],
  modules: ['name', 'active'],
};

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (!ctx || ctx instanceof NextResponse) {
    return ctx instanceof NextResponse ? ctx : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  try {
    const body = await readJsonBody(req);
    const validated = validateBody(updateRecordSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { table, id, field, value } = validated.data;

    const allowedTables = [
      'tenants', 'contacts', 'leads', 'deals', 'companies',
      'tasks', 'webhooks',
      'email_templates', 'workflows', 'automations', 'forms',
      'pipelines', 'deal_stages', 'tags', 'modules',
    ];
    if (!allowedTables.includes(table)) {
      return NextResponse.json({ error: `Table '${table}' is not allowed for editing` }, { status: 400 });
    }

    // Validate column name against per-table allowlist (Issue #683)
    const safeField = field.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeField) {
      return NextResponse.json({ error: 'Invalid field name' }, { status: 400 });
    }
    const tableColumns = ALLOWED_COLUMNS[table];
    if (!tableColumns || !tableColumns.includes(safeField)) {
      return NextResponse.json(
        { error: `Column '${safeField}' is not allowed for editing on table '${table}'` },
        { status: 400 },
      );
    }

    const result = await db.execute(sql`
      UPDATE ${sql.identifier(table)} SET ${sql.identifier(safeField)} = ${value}, updated_at = now() 
      WHERE id = ${id} RETURNING id, ${sql.identifier(safeField)}
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'data.updated',
      targetType: table,
      targetId: id,
      metadata: { field: safeField, value },
    });

    return NextResponse.json({
      message: 'Record updated',
      data: result.rows[0],
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── Delete a Record ─────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (!ctx || ctx instanceof NextResponse) {
    return ctx instanceof NextResponse ? ctx : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  try {
    const body = await readJsonBody(req);
    const validated = validateBody(deleteRecordSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { table, id, softDelete } = validated.data;

    if (!table || !id) {
      return NextResponse.json({ error: 'table and id are required' }, { status: 400 });
    }

    const allowedTables = [
      'contacts', 'leads', 'deals', 'companies',
      'tasks', 'webhooks',
      'email_templates', 'workflows', 'automations', 'forms',
      'tags', 'notes',
    ];
    if (!allowedTables.includes(table)) {
      return NextResponse.json({ error: `Table '${table}' is not allowed for deletion` }, { status: 400 });
    }

    if (!softDelete && !validated.data.confirm) {
      return NextResponse.json({ error: 'Hard delete requires confirm: true in request body' }, { status: 400 });
    }

    if (softDelete) {
      const result = await db.execute(sql`
        UPDATE ${sql.identifier(table)} SET deleted_at = NOW() WHERE id = ${id} RETURNING id
      `);
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
    } else {
      const result = await db.execute(sql`
        DELETE FROM ${sql.identifier(table)} WHERE id = ${id} RETURNING id
      `);
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
    }

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'data.deleted',
      targetType: table,
      targetId: id,
      metadata: { softDelete: !!softDelete },
    });

    return NextResponse.json({ message: 'Record deleted', id });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

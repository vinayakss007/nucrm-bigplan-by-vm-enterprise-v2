import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * Custom Report Builder API
 *
 * Saves and retrieves custom report configurations.
 * Report definitions are stored as JSON in a generic reports table.
 */

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'analytics-pro');
    if (moduleGate) return moduleGate;

    // Fetch saved reports from a simple query
    const reports = await db.execute(
      sql`SELECT id, tenant_id, name, config, created_at, updated_at
          FROM custom_reports
          WHERE tenant_id = ${ctx.tenantId} AND deleted_at IS NULL
          ORDER BY updated_at DESC
          LIMIT 100`
    );

    return NextResponse.json({ data: reports.rows });
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'analytics-pro');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const { name, config } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'config object is required' }, { status: 400 });
    }

    // Validate config has required fields
    const { dataSource, columns, filters, chartType } = config;
    if (!dataSource) {
      return NextResponse.json({ error: 'config.dataSource is required' }, { status: 400 });
    }

    const result = await db.execute(
      sql`INSERT INTO custom_reports (id, tenant_id, name, config, created_by, created_at, updated_at)
          VALUES (gen_random_uuid(), ${ctx.tenantId}, ${name}, ${JSON.stringify(config)}::jsonb, ${ctx.userId}, NOW(), NOW())
          RETURNING id, tenant_id, name, config, created_at`
    );

    const saved = result.rows[0];
    return NextResponse.json({ data: saved }, { status: 201 });
  } catch (err: any) { return apiError(err); }
}

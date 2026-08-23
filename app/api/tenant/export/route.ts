/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, leads, tasks, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { escapeCSV } from '@/lib/export';

/**
 * POST /api/tenant/export
 * Exports tenant data as JSON or CSV format.
 *
 * Body: { entity: 'contacts'|'companies'|'deals'|'leads'|'tasks'|'activities', format?: 'json'|'csv' }
 * Returns the data immediately for small datasets.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'export', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { entity, format = 'json' } = body as { entity: string; format?: string };

    if (!entity) {
      return NextResponse.json({ error: 'entity is required' }, { status: 400 });
    }

    const validEntities = ['contacts', 'companies', 'deals', 'leads', 'tasks', 'activities'];
    if (!validEntities.includes(entity)) {
      return NextResponse.json({ error: `Invalid entity. Must be one of: ${validEntities.join(', ')}` }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantFilter = (table: { tenantId: any; deletedAt?: any }) =>
      and(eq(table.tenantId, ctx.tenantId), table.deletedAt ? isNull(table.deletedAt) : undefined);

    switch (entity) {
      case 'contacts':
        data = await db.select().from(contacts).where(tenantFilter(contacts)).limit(10000);
        break;
      case 'companies':
        data = await db.select().from(companies).where(tenantFilter(companies)).limit(10000);
        break;
      case 'deals':
        data = await db.select().from(deals).where(tenantFilter(deals)).limit(10000);
        break;
      case 'leads':
        data = await db.select().from(leads).where(tenantFilter(leads)).limit(10000);
        break;
      case 'tasks':
        data = await db.select().from(tasks).where(tenantFilter(tasks)).limit(10000);
        break;
      case 'activities':
        data = await db.select().from(activities).where(eq(activities.tenantId, ctx.tenantId)).limit(10000);
        break;
    }

    if (format === 'csv') {
      if (data.length === 0) {
        return new NextResponse('', {
          status: 200,
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${entity}-export.csv"` },
        });
      }
      // Convert to CSV with formula injection protection via shared escapeCSV
      const headers = Object.keys(data[0]!);
      const csvRows = [
        headers.join(','),
        ...data.map(row =>
          headers.map(h => escapeCSV((row as Record<string, unknown>)[h])).join(',')
        ),
      ];
      const csv = csvRows.join('\n');

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${entity}-export.csv"`,
        },
      });
    }

    return NextResponse.json({
      data,
      meta: { entity, total: data.length, exported_at: new Date().toISOString(), format: 'json' },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

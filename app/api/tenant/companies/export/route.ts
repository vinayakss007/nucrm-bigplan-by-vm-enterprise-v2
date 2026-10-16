/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { companies } from '@/drizzle/schema';
import { eq, asc } from 'drizzle-orm';
import { escapeCSV } from '@/lib/export';
import { enforceFieldRead } from '@/lib/rbac/enforce';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'companies.export');
    if (deny) return deny;

    const rows = await db
      .select({
        name: companies.name,
        domain: companies.domain,
        industry: companies.industry,
        phone: companies.phone,
        address: companies.address,
        city: companies.city,
        state: companies.state,
        country: companies.country,
        postalCode: companies.postalCode,
        numberOfEmployees: companies.companySize,
        annualRevenue: companies.annualRevenue,
        notes: companies.notes,
        tags: companies.tags,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .orderBy(asc(companies.createdAt));

    // [CSV header, row key] in the order the file is written.
    const COLUMNS: ReadonlyArray<readonly [string, string]> = [
      ['name', 'name'], ['domain', 'domain'], ['industry', 'industry'],
      ['phone', 'phone'], ['address', 'address'], ['city', 'city'],
      ['state', 'state'], ['country', 'country'], ['postal_code', 'postalCode'],
      ['company_size', 'numberOfEmployees'], ['annual_revenue', 'annualRevenue'],
      ['notes', 'notes'], ['tags', 'tags'], ['created_at', 'createdAt'],
    ];

    // #2618 — the CSV used to bypass field_permissions entirely (same fix as
    // #2614 for deals and #2618 for contacts). Project the rows first, then
    // drop any column the role may not read from the header AND every row, so
    // a restricted value cannot survive as an unnamed cell.
    const projected = await enforceFieldRead(ctx, 'companies', rows);
    const visible = COLUMNS.filter(([, key]) => projected.every((r) => key in r));
    const csvRows = projected.map((r) => visible.map(([, key]) =>
      escapeCSV((r as Record<string, unknown>)[key])).join(','));

    const csv = [visible.map(([header]) => header).join(','), ...csvRows].join('\n');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="companies-export.csv"`,
      },
    });
  } catch (err: unknown) {
    await logError({ error: err, context: 'tenant/companies export GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
});

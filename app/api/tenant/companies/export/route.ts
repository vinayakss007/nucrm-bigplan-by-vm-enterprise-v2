/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { companies } from '@/drizzle/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { escapeCSV, MAX_EXPORT_ROWS, ExportLimitError } from '@/lib/export';
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
      // #2668: no tombstone filter, so a deleted company was written into the CSV
      // with its website, phone, annual revenue and notes while the on-screen list
      // it was exported from did not show it — the file was a strict superset of
      // what the customer could see, and its row count matched nothing.
      // `deals/export/route.ts:41-43` carries the same rule, added by #2291; the
      // generic engine (`lib/export/index.ts:190`) and this route's own list
      // (`companies/route.ts:40-43`) already filtered `deletedAt`.
      .where(and(eq(companies.tenantId, ctx.tenantId), isNull(companies.deletedAt)))
      .orderBy(asc(companies.createdAt))
      // #3153: cap the read like the contacts/leads exports and the generic
      // engine do; the +1 probe row detects an over-limit filter, which is
      // answered 413 below instead of materialising the whole tenant.
      .limit(MAX_EXPORT_ROWS + 1);

    if (rows.length > MAX_EXPORT_ROWS) throw new ExportLimitError(MAX_EXPORT_ROWS);

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
    // #3153: over-limit is client-actionable — 413, not a server fault.
    if (err instanceof ExportLimitError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    await logError({ error: err, context: 'tenant/companies export GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
});

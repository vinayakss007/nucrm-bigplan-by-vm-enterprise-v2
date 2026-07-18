import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { companies } from '@/drizzle/schema';
import { eq, asc } from 'drizzle-orm';

function escapeCSV(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: NextRequest) {
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
        email: companies.email,
        address: companies.address,
        city: companies.city,
        state: companies.state,
        country: companies.country,
        postalCode: companies.postalCode,
        numberOfEmployees: companies.numberOfEmployees,
        annualRevenue: companies.annualRevenue,
        notes: companies.notes,
        tags: companies.tags,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .orderBy(asc(companies.createdAt));

    const headers = ['name', 'domain', 'industry', 'phone', 'email', 'address', 'city', 'state', 'country', 'postal_code', 'employees', 'annual_revenue', 'notes', 'tags', 'created_at'];
    const csvRows = rows.map(r => [
      escapeCSV(r.name),
      escapeCSV(r.domain),
      escapeCSV(r.industry),
      escapeCSV(r.phone),
      escapeCSV(r.email),
      escapeCSV(r.address),
      escapeCSV(r.city),
      escapeCSV(r.state),
      escapeCSV(r.country),
      escapeCSV(r.postalCode),
      escapeCSV(r.numberOfEmployees),
      escapeCSV(r.annualRevenue),
      escapeCSV(r.notes),
      escapeCSV(r.tags),
      escapeCSV(r.createdAt),
    ].join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="companies-export.csv"`,
      },
    });
  } catch (err: unknown) {
    console.error('[companies export GET]', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}

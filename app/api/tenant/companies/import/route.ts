/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { companies, activities } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? '']));
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += line[i];
  }
  result.push(current); return result;
}

const COLUMN_MAP: Record<string, string> = {
  'name': 'name', 'company_name': 'name', 'company': 'name', 'organization': 'name',
  'domain': 'domain', 'website': 'domain', 'url': 'domain',
  'industry': 'industry', 'sector': 'industry',
  'phone': 'phone', 'phone_number': 'phone', 'telephone': 'phone',
  'email': 'email', 'email_address': 'email',
  'address': 'address', 'street': 'address', 'street_address': 'address',
  'city': 'city',
  'state': 'state', 'province': 'state', 'region': 'state',
  'country': 'country',
  'postal_code': 'postalCode', 'zipcode': 'postalCode', 'zip': 'postalCode',
  'employees': 'numberOfEmployees', 'number_of_employees': 'numberOfEmployees', 'employee_count': 'numberOfEmployees',
  'revenue': 'annualRevenue', 'annual_revenue': 'annualRevenue',
  'industry_segment': 'industrySegment', 'segment': 'industrySegment',
  'notes': 'notes', 'description': 'notes',
  'tags': 'tags', 'tag': 'tags',
};

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await checkRateLimit(request, { action: 'csv_import', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'companies.import');
    if (deny) return deny;

    const rawBody = await readJsonBody(request);
    const { csv } = rawBody;
    if (!csv) return NextResponse.json({ error: 'csv field required' }, { status: 400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    if (rows.length > 50000) return NextResponse.json({ error: 'CSV too large (max 50,000 rows)' }, { status: 400 });

    const results = { imported: 0, updated: 0, skipped: 0, errors: [] as string[] };
    const BATCH_SIZE = 500;

    await db.transaction(async (tx) => {
      const insertBuffer: { tenantId: string; name: string; createdBy: string; domain?: string; industry?: string; phone?: string; email?: string; address?: string; city?: string; state?: string; country?: string; postalCode?: string; numberOfEmployees?: number; annualRevenue?: string; industrySegment?: string; notes?: string; tags?: string[] }[] = [];

      for (const [index, row] of rows.entries()) {
        try {
          const mapped: Record<string, string> = {};
          for (const [key, val] of Object.entries(row)) {
            const dbCol = COLUMN_MAP[key.toLowerCase().trim()];
            if (dbCol && val) mapped[dbCol] = val;
          }

          if (!mapped.name) {
            results.errors.push(`Row ${index + 2}: name is required`);
            results.skipped++;
            continue;
          }

          // Check for existing company by name
          const [existing] = await tx
            .select({ id: companies.id })
            .from(companies)
            .where(and(eq(companies.tenantId, ctx.tenantId), sql`lower(${companies.name}) = ${mapped.name.toLowerCase().trim()}`, sql`${companies.deletedAt} IS NULL`))
            .limit(1);

          if (existing) {
            results.skipped++;
            continue;
          }

          const tags = mapped.tags ? mapped.tags.split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [];

          insertBuffer.push({
            tenantId: ctx.tenantId,
            name: mapped.name.trim(),
            createdBy: ctx.userId,
            domain: mapped.domain || undefined,
            industry: mapped.industry || undefined,
            phone: mapped.phone || undefined,
            email: mapped.email || undefined,
            address: mapped.address || undefined,
            city: mapped.city || undefined,
            state: mapped.state || undefined,
            country: mapped.country || undefined,
            postalCode: mapped.postalCode || undefined,
            numberOfEmployees: mapped.numberOfEmployees ? parseInt(mapped.numberOfEmployees) : undefined,
            annualRevenue: mapped.annualRevenue || undefined,
            industrySegment: mapped.industrySegment || undefined,
            notes: mapped.notes || undefined,
            tags: tags.length > 0 ? tags : undefined,
          });

          if (insertBuffer.length >= BATCH_SIZE) {
            await tx.insert(companies).values(insertBuffer);
            results.imported += insertBuffer.length;
            insertBuffer.length = 0;
          }
        } catch (rowErr: unknown) {
          const message = rowErr instanceof Error ? rowErr.message : String(rowErr);
          results.errors.push(`Row ${index + 2}: ${message}`);
          results.skipped++;
        }
      }

      if (insertBuffer.length > 0) {
        await tx.insert(companies).values(insertBuffer);
        results.imported += insertBuffer.length;
      }

      // Log activity
      if (results.imported > 0) {
        await tx.insert(activities).values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          eventType: 'company_created',
          description: `Imported ${results.imported} companies (${results.skipped} skipped)`,
          entityType: 'bulk_import',
          entityId: sql`gen_random_uuid()`,
          action: 'import_completed',
        });
      }
    });

    return NextResponse.json({ ok: true, results });
  } catch (err: unknown) {
    console.error('[companies import POST]', err);
    return apiError(err);
  }
});

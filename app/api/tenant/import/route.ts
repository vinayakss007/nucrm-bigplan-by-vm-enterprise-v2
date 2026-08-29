/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, leads } from '@/drizzle/schema';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/import
 * Import records from CSV data (parsed client-side, sent as JSON array).
 *
 * Body: { entity: 'contacts'|'companies'|'leads', records: Array<Record<string, string>> }
 * Each record is a flat object with column headers as keys.
 *
 * Returns: { imported: number, errors: Array<{ row: number, error: string }> }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'import', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { entity, records } = body as { entity: string; records: Array<Record<string, string>> };

    if (!entity || !records || !Array.isArray(records)) {
      return NextResponse.json({ error: 'entity and records[] required' }, { status: 400 });
    }

    const validEntities = ['contacts', 'companies', 'leads'];
    if (!validEntities.includes(entity)) {
      return NextResponse.json({ error: `Invalid entity. Must be one of: ${validEntities.join(', ')}` }, { status: 400 });
    }

    if (records.length === 0) {
      return NextResponse.json({ data: { imported: 0, errors: [] } });
    }

    if (records.length > 1000) {
      return NextResponse.json({ error: 'Max 1000 records per import. Use multiple requests for larger datasets.' }, { status: 400 });
    }

    const errors: Array<{ row: number; error: string }> = [];
    let imported = 0;

    // Process in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      try {
        switch (entity) {
          case 'contacts': {
            const values = batch.map((r, idx) => {
              if (!r.first_name && !r.firstName) {
                errors.push({ row: i + idx + 1, error: 'first_name is required' });
                return null;
              }
              return {
                tenantId: ctx.tenantId,
                firstName: r.first_name || r.firstName || '',
                lastName: r.last_name || r.lastName || null,
                email: r.email || null,
                phone: r.phone || null,
                jobTitle: r.job_title || r.jobTitle || null,
                leadStatus: 'new' as const,
                createdBy: ctx.userId,
              };
            }).filter((v): v is NonNullable<typeof v> => v !== null);

            if (values.length > 0) {
              await db.insert(contacts).values(values);
              imported += values.length;
            }
            break;
          }

          case 'companies': {
            const values = batch.map((r, idx) => {
              if (!r.name) {
                errors.push({ row: i + idx + 1, error: 'name is required' });
                return null;
              }
              return {
                tenantId: ctx.tenantId,
                name: r.name,
                website: r.website || null,
                industry: r.industry || null,
                phone: r.phone || null,
                createdBy: ctx.userId,
              };
            }).filter((v): v is NonNullable<typeof v> => v !== null);

            if (values.length > 0) {
              await db.insert(companies).values(values);
              imported += values.length;
            }
            break;
          }

          case 'leads': {
            const values = batch.map((r, idx) => {
              if (!r.first_name && !r.firstName) {
                errors.push({ row: i + idx + 1, error: 'first_name is required' });
                return null;
              }
              return {
                tenantId: ctx.tenantId,
                firstName: r.first_name || r.firstName || '',
                // leads.lastName is NOT NULL (default ''), unlike contacts.lastName
                // which is nullable — so this branch cannot pass null.
                lastName: r.last_name || r.lastName || '',
                email: r.email || null,
                phone: r.phone || null,
                companyName: r.company || r.company_name || null,
                leadStatus: 'new' as const,
                source: r.source || r.lead_source || null,
                createdBy: ctx.userId,
              };
            }).filter((v): v is NonNullable<typeof v> => v !== null);

            if (values.length > 0) {
              await db.insert(leads).values(values);
              imported += values.length;
            }
            break;
          }
        }
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : 'Unknown error';
        errors.push({ row: i + 1, error: `Batch failed: ${msg}` });
      }
    }

    return NextResponse.json({
      data: { imported, errors, total_records: records.length },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

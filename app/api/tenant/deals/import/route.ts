/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { importSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, contacts, companies, pipelines, dealStages, activities, tenants, plans } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
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
  'title': 'title', 'deal_name': 'title', 'deal': 'title', 'name': 'title', 'deal_title': 'title',
  'amount': 'amount', 'value': 'amount', 'deal_amount': 'amount', 'deal_value': 'amount', 'revenue': 'amount',
  'close_date': 'closeDate', 'closedate': 'closeDate', 'expected_close_date': 'closeDate', 'close': 'closeDate',
  'pipeline': 'pipeline', 'pipeline_name': 'pipeline',
  'stage': 'stage', 'deal_stage': 'stage', 'stage_name': 'stage',
  'contact': 'contact', 'contact_email': 'contact', 'contactemail': 'contact',
  'company': 'company', 'company_name': 'company', 'organization': 'company',
  'assigned_to': 'assignedTo', 'assignedto': 'assignedTo', 'owner': 'assignedTo', 'deal_owner': 'assignedTo',
  'notes': 'notes', 'description': 'notes', 'note': 'notes',
  'tags': 'tags', 'tag': 'tags',
  'priority': 'priority',
  'status': 'status', 'deal_status': 'status',
  'external_id': 'externalId', 'externalid': 'externalId', 'external_deal_id': 'externalId', 'crm_id': 'externalId',
};

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await checkRateLimit(request, { action: 'csv_import', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'deals.import');
    if (deny) return deny;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(importSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { csv } = rawBody;
    if (!csv) return NextResponse.json({ error: 'csv field required' }, { status: 400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    if (rows.length > 50000) return NextResponse.json({ error: 'CSV too large (max 50,000 rows)' }, { status: 400 });

    const results = { imported: 0, updated: 0, skipped: 0, skipped_duplicates: 0, errors: [] as string[] };
    const BATCH_SIZE = 500;

    await db.transaction(async (tx) => {
      // Plan limits check
      const [tenantWithPlan] = await tx
        .select({
          currentDeals: tenants.currentDeals,
          maxDeals: plans.maxDeals,
        })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.id, ctx.tenantId))
        .for('update');

      if (tenantWithPlan && tenantWithPlan.maxDeals != null && ((tenantWithPlan.currentDeals ?? 0) + rows.length) > tenantWithPlan.maxDeals) {
        throw new Error(`Import would exceed plan limit of ${tenantWithPlan.maxDeals} deals.`);
      }

      // Cache pipeline + stage lookups
      const pipelineCache: Record<string, string> = {};
      const stageCache: Record<string, string> = {};
      const contactCache: Record<string, string> = {};
      const companyCache: Record<string, string> = {};
      const userCache: Record<string, string> = {};

      // Get default pipeline if none specified in CSV
      const [defaultPipeline] = await tx
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)))
        .limit(1);

      const resolvePipeline = async (name?: string): Promise<string | null> => {
        const key = (name || '').toLowerCase().trim();
        if (key && pipelineCache[key]) return pipelineCache[key];

        const [pipeline] = key
          ? await tx.select({ id: pipelines.id })
              .from(pipelines)
              .where(and(eq(pipelines.tenantId, ctx.tenantId), sql`lower(${pipelines.name}) = ${key}`))
              .limit(1)
          : defaultPipeline
            ? [defaultPipeline]
            : [];

        if (!pipeline) return null;
        if (key) pipelineCache[key] = pipeline.id;
        return pipeline.id;
      };

      const resolveStage = async (pipelineId: string, stageName?: string): Promise<string | null> => {
        if (!stageName?.trim()) return null;
        const key = `${pipelineId}:${stageName.toLowerCase().trim()}`;
        if (stageCache[key]) return stageCache[key];

        const [stage] = await tx
          .select({ id: dealStages.id })
          .from(dealStages)
          .where(and(eq(dealStages.pipelineId, pipelineId), sql`lower(${dealStages.name}) = ${stageName.toLowerCase().trim()}`))
          .limit(1);

        if (!stage) return null;
        stageCache[key] = stage.id;
        return stage.id;
      };

      const resolveContact = async (email?: string): Promise<string | null> => {
        if (!email?.trim()) return null;
        const key = email.toLowerCase().trim();
        if (contactCache[key]) return contactCache[key];

        const [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.tenantId, ctx.tenantId), sql`lower(${contacts.email}) = ${key}`, sql`${contacts.deletedAt} IS NULL`))
          .limit(1);

        if (!contact) return null;
        contactCache[key] = contact.id;
        return contact.id;
      };

      const resolveCompany = async (name?: string): Promise<string | null> => {
        if (!name?.trim()) return null;
        const key = name.toLowerCase().trim();
        if (companyCache[key]) return companyCache[key];

        const [company] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.tenantId, ctx.tenantId), sql`lower(${companies.name}) = ${key}`, sql`${companies.deletedAt} IS NULL`))
          .limit(1);

        if (!company) return null;
        companyCache[key] = company.id;
        return company.id;
      };

      const resolveUser = async (email?: string): Promise<string | null> => {
        if (!email?.trim()) return null;
        const key = email.toLowerCase().trim();
        if (userCache[key]) return userCache[key];

        // #1122: only resolve users who are ACTIVE members of THIS tenant.
        // A bare `WHERE lower(email) = ...` matched users across all tenants,
        // allowing an import to assign deals to users from other tenants.
        const result = await tx.execute(sql`
          SELECT u.id FROM users u
          INNER JOIN tenant_members tm ON tm.user_id = u.id
          WHERE lower(u.email) = ${key}
            AND tm.tenant_id = ${ctx.tenantId}
            AND tm.status = 'active'
          LIMIT 1
        `);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (result.rows[0] as any)?.id ?? null;

        if (!userId) return null;
        userCache[key] = userId;
        return userId;
      };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertBuffer: any[] = [];

      // Dedupe (#1122): match existing deals by (tenantId, title) OR externalId
      // (stored in metadata.external_id). Duplicates are skipped and reported.
      const dealTitleCache = new Map<string, string>();
      const dealExtCache = new Map<string, string>();
      const seenInFile = new Set<string>();

      const findExistingDeal = async (title?: string, extId?: string): Promise<string | null> => {
        if (extId) {
          const cached = dealExtCache.get(extId);
          if (cached) return cached;
          const [row] = await tx
            .select({ id: deals.id })
            .from(deals)
            .where(and(
              eq(deals.tenantId, ctx.tenantId),
              sql`${deals.metadata}->>'external_id' = ${extId}`,
              sql`${deals.deletedAt} IS NULL`
            ))
            .limit(1);
          if (row) { dealExtCache.set(extId, row.id); return row.id; }
        }
        if (title?.trim()) {
          const key = title.toLowerCase().trim();
          const cached = dealTitleCache.get(key);
          if (cached) return cached;
          const [row] = await tx
            .select({ id: deals.id })
            .from(deals)
            .where(and(
              eq(deals.tenantId, ctx.tenantId),
              sql`lower(${deals.title}) = ${key}`,
              sql`${deals.deletedAt} IS NULL`
            ))
            .limit(1);
          if (row) { dealTitleCache.set(key, row.id); return row.id; }
        }
        return null;
      };

      for (const [index, row] of rows.entries()) {
        try {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapped: any = {};
          for (const [key, val] of Object.entries(row)) {
            const dbCol = COLUMN_MAP[key.toLowerCase().trim()];
            if (dbCol && val) mapped[dbCol] = val;
          }

          if (!mapped.title) {
            results.errors.push(`Row ${index + 2}: title is required`);
            results.skipped++;
            continue;
          }

          // Skip duplicates (#1122): existing deal (by title or externalId) or
          // an earlier row in this same file with the same identity.
          const existingDealId = await findExistingDeal(mapped.title, mapped.externalId);
          const identityKey = mapped.externalId
            ? `e:${mapped.externalId}`
            : `t:${mapped.title.toLowerCase().trim()}`;
          if (existingDealId || seenInFile.has(identityKey)) {
            results.skipped_duplicates++;
            results.skipped++;
            continue;
          }
          seenInFile.add(identityKey);

          const pipelineId = await resolvePipeline(mapped.pipeline);
          if (!pipelineId) {
            results.errors.push(`Row ${index + 2}: pipeline "${mapped.pipeline || '(default)'}" not found`);
            results.skipped++;
            continue;
          }

          const stageId = mapped.stage
            ? await resolveStage(pipelineId, mapped.stage)
            : null;

          if (mapped.stage && !stageId) {
            results.errors.push(`Row ${index + 2}: stage "${mapped.stage}" not found in pipeline`);
            results.skipped++;
            continue;
          }

          // Get first stage if no stage specified
          let resolvedStageId = stageId;
          if (!resolvedStageId) {
            const [firstStage] = await tx
              .select({ id: dealStages.id })
              .from(dealStages)
              .where(eq(dealStages.pipelineId, pipelineId))
              .orderBy(sql`${dealStages.order} ASC NULLS LAST`)
              .limit(1);
            resolvedStageId = firstStage?.id ?? null;
          }

          if (!resolvedStageId) {
            results.errors.push(`Row ${index + 2}: no stages found in pipeline`);
            results.skipped++;
            continue;
          }

          const contactId = await resolveContact(mapped.contact);
          const companyId = await resolveCompany(mapped.company);
          const assignedTo = mapped.assignedTo ? await resolveUser(mapped.assignedTo) : ctx.userId;

          const tags = mapped.tags ? mapped.tags.split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [];

          // Validate closeDate - skip invalid dates with a warning instead of crashing
          let closeDate: Date | null = null;
          if (mapped.closeDate) {
            const parsedDate = new Date(mapped.closeDate);
            if (isNaN(parsedDate.getTime())) {
              results.errors.push(`Row ${index + 2}: invalid close_date "${mapped.closeDate}" — field skipped`);
            } else {
              closeDate = parsedDate;
            }
          }

          // L-2: validate amount so a stray "1,000"/"abc" doesn't make Postgres
          // reject the row. Strip thousands separators/currency symbols, then
          // fall back to '0' with a warning if it still isn't a finite number.
          let amount = '0';
          if (mapped.amount !== undefined && mapped.amount !== null && String(mapped.amount).trim() !== '') {
            const cleaned = String(mapped.amount).replace(/[,\s$€£]/g, '');
            const parsedAmount = Number(cleaned);
            if (Number.isFinite(parsedAmount)) {
              amount = String(parsedAmount);
            } else {
              results.errors.push(`Row ${index + 2}: invalid amount "${mapped.amount}" — defaulted to 0`);
            }
          }

          insertBuffer.push({
            tenantId: ctx.tenantId,
            createdBy: ctx.userId,
            title: mapped.title.trim(),
            amount,
            closeDate,
            pipelineId,
            stageId: resolvedStageId,
            stageEnteredAt: new Date(),
            contactId,
            companyId,
            assignedTo: assignedTo || ctx.userId,
            tags: tags.length > 0 ? tags : undefined,
            metadata: mapped.externalId ? { external_id: mapped.externalId } : undefined,
          });

          if (insertBuffer.length >= BATCH_SIZE) {
            await tx.insert(deals).values(insertBuffer);
            results.imported += insertBuffer.length;
            insertBuffer.length = 0;
          }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (rowErr: any) {
          results.errors.push(`Row ${index + 2}: ${rowErr.message}`);
          results.skipped++;
        }
      }

      if (insertBuffer.length > 0) {
        await tx.insert(deals).values(insertBuffer);
        results.imported += insertBuffer.length;
      }

      // Log activity
      if (results.imported > 0) {
        await tx.insert(activities).values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          eventType: 'deal_created',
          description: `Imported ${results.imported} deals (${results.skipped} skipped)`,
          entityType: 'bulk_import',
          entityId: sql`gen_random_uuid()`,
          action: 'import_completed',
        });

        // Update deal counter
        await tx
          .update(tenants)
          .set({
            currentDeals: sql`${tenants.currentDeals} + ${results.imported}`,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, ctx.tenantId));
      }
    });

    // Audit log
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'deals.imported',
      entityType: 'deal',
      newData: { imported: results.imported, skipped: results.skipped, skipped_duplicates: results.skipped_duplicates, errors: results.errors.length },
    });

    return NextResponse.json({ ok: true, results });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant/deals import POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

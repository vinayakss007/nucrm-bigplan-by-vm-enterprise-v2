import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { importSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, contacts, companies, pipelines, dealStages, activities } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';

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
};

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'csv_import', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'deals.import');
    if (deny) return deny;

    const rawBody = await request.json();
    const validated = validateBody(importSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { csv } = rawBody;
    if (!csv) return NextResponse.json({ error: 'csv field required' }, { status: 400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    if (rows.length > 50000) return NextResponse.json({ error: 'CSV too large (max 50,000 rows)' }, { status: 400 });

    const results = { imported: 0, updated: 0, skipped: 0, errors: [] as string[] };
    const BATCH_SIZE = 500;

    await db.transaction(async (tx) => {
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
          .where(and(eq(contacts.tenantId, ctx.tenantId), eq(sql`lower(${contacts.email})`, key), sql`${contacts.deletedAt} IS NULL`))
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
          .where(and(eq(companies.tenantId, ctx.tenantId), eq(sql`lower(${companies.name})`, key), sql`${companies.deletedAt} IS NULL`))
          .limit(1);

        if (!company) return null;
        companyCache[key] = company.id;
        return company.id;
      };

      const resolveUser = async (email?: string): Promise<string | null> => {
        if (!email?.trim()) return null;
        const key = email.toLowerCase().trim();
        if (userCache[key]) return userCache[key];

        const result = await tx.execute(sql`
          SELECT id FROM users WHERE lower(email) = ${key} LIMIT 1
        `);
        const userId = result.rows[0]?.id ?? null;

        if (!userId) return null;
        userCache[key] = userId;
        return userId;
      };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertBuffer: any[] = [];

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

          insertBuffer.push({
            tenantId: ctx.tenantId,
            createdBy: ctx.userId,
            title: mapped.title.trim(),
            amount: mapped.amount || '0',
            closeDate: mapped.closeDate ? new Date(mapped.closeDate) : null,
            pipelineId,
            stageId: resolvedStageId,
            stageEnteredAt: new Date(),
            contactId,
            companyId,
            assignedTo: assignedTo || ctx.userId,
            tags: tags.length > 0 ? tags : undefined,
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
      }
    });

    return NextResponse.json({ ok: true, results });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[deals import POST]', err);
    return apiError(err);
  }
}

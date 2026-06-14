import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { importSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, tenants, plans, activities } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g,'_'));
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? '']));
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (inQuotes && line[i+1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += line[i];
  }
  result.push(current); return result;
}

const COLUMN_MAP: Record<string, string> = {
  // Names
  'first_name':'firstName','firstname':'firstName','first name':'firstName',
  'last_name':'lastName','lastname':'lastName','last name':'lastName','surname':'lastName',
  'full_name':'fullName','fullname':'fullName','name':'fullName',
  // Contact
  'email':'email','email_address':'email','emailaddress':'email',
  'phone':'phone','phone_number':'phone','mobile':'phone','telephone':'phone','fax':'phone',
  // Company
  'company':'company_name','company_name':'company_name','organization':'company_name','org':'company_name',
  'job_title':'jobTitle','title':'jobTitle','position':'jobTitle','role':'jobTitle',
  // Address
  'address':'address','street':'address','street_address':'address',
  'city':'city','state':'state','province':'state','region':'state',
  'country':'country','postal_code':'postalCode','zipcode':'postalCode','zip':'postalCode',
  // Web/Social
  'website':'website','url':'website','linkedin':'linkedinUrl','linkedin_url':'linkedinUrl',
  'twitter':'twitterUrl','twitter_url':'twitterUrl','facebook':'facebookUrl','facebook_url':'facebookUrl',
  // Lead info
  'lead_source':'leadSource','source':'leadSource',
  'lead_status':'leadStatus','status':'leadStatus',
  'score':'score','rating':'score',
  // Other
  'notes':'notes','note':'notes','description':'notes','comments':'notes',
  'tags':'tags','tag':'tags',
  'lifecycle_stage':'lifecycleStage','stage':'lifecycleStage',
  'assigned_to':'assignedTo','owner':'assignedTo',
  'industry':'industry','department':'department',
  'annual_revenue':'annualRevenue','revenue':'annualRevenue',
  'number_of_employees':'numberOfEmployees','employees':'numberOfEmployees',
};

const VALID_STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action:'csv_import', max:10, windowMinutes:60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.import');
    if (deny) return deny;

    const rawBody = await request.json();
    const validated = validateBody(importSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { csv, skipDuplicates = true, updateExisting = false } = { ...rawBody, csv: rawBody.csv };
    if (!csv) return NextResponse.json({ error:'csv field required' }, { status:400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error:'No data rows found in CSV' }, { status:400 });
    if (rows.length > 50000) return NextResponse.json({ error:'CSV too large (max 50,000 rows)' }, { status:400 });

    const results = { imported:0, updated:0, skipped:0, errors:[] as string[] };
    const BATCH_SIZE = 500;
    const MAX_COMPANY_CACHE = 5000;
    const companyCache: Record<string, string> = {};

    await db.transaction(async (tx) => {
      // Plan limits check
      const [tenantWithPlan] = await tx
        .select({
          currentContacts: tenants.currentContacts,
          maxContacts: plans.maxContacts
        })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.id, ctx.tenantId))
        .for('update');

      if (tenantWithPlan && tenantWithPlan.maxContacts != null && ((tenantWithPlan.currentContacts ?? 0) + rows.length) > tenantWithPlan.maxContacts) {
        throw new Error(`Import would exceed plan limit of ${tenantWithPlan.maxContacts} contacts.`);
      }

      const getOrCreateCompany = async (name: string): Promise<string | null> => {
        if (!name?.trim()) return null;
        const key = name.toLowerCase().trim();
        if (companyCache[key]) return companyCache[key];
        
        const cacheKeys = Object.keys(companyCache);
        if (cacheKeys.length >= MAX_COMPANY_CACHE && cacheKeys[0]) {
          delete companyCache[cacheKeys[0]];
        }
        
        const [co] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.tenantId, ctx.tenantId), eq(sql`lower(${companies.name})`, key), sql`${companies.deletedAt} IS NULL`))
          .limit(1);
        
        if (co) {
          companyCache[key] = co.id;
          return co.id;
        }

        const [newCo] = await tx
          .insert(companies)
          .values({
            tenantId: ctx.tenantId,
            name: name.trim(),
            createdBy: ctx.userId,
          })
          .returning({ id: companies.id });
        
        if (!newCo) return null;
        companyCache[key] = newCo.id;
        return newCo.id;
      };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertBuffer: any[] = [];
      
      for (const [index, row] of rows.entries()) {
        try {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapped: any = {};
          for (const [key, val] of Object.entries(row)) {
            const dbCol = COLUMN_MAP[key.toLowerCase().trim()];
            if (dbCol && val) mapped[dbCol] = val;
          }

          if (!mapped.firstName) {
            results.errors.push(`Row ${index+2}: first_name is required`);
            results.skipped++;
            continue;
          }

          if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) {
            results.errors.push(`Row ${index+2}: invalid email "${mapped.email}"`);
            results.skipped++;
            continue;
          }

          const companyId = await getOrCreateCompany(mapped.company_name || '');
          const leadStatus = VALID_STATUSES.includes(mapped.leadStatus) ? mapped.leadStatus : 'new';
          const tags = mapped.tags ? mapped.tags.split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [];
          const score = mapped.score ? parseInt(mapped.score) : 0;

          if (mapped.email) {
            const [existing] = await tx
              .select({ id: contacts.id })
              .from(contacts)
              .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.email, mapped.email.toLowerCase().trim()), sql`${contacts.deletedAt} IS NULL`))
              .limit(1);

            if (existing) {
              if (skipDuplicates && !updateExisting) {
                results.skipped++;
                continue;
              }
              if (updateExisting) {
                await tx
                  .update(contacts)
                  .set({
                    firstName: mapped.firstName,
                    lastName: mapped.lastName || '',
                    phone: mapped.phone || null,
                    companyId,
                    leadStatus,
                    leadSource: mapped.leadSource || null,
                    notes: mapped.notes || null,
                    city: mapped.city || null,
                    country: mapped.country || null,
                    state: mapped.state || null,
                    address: mapped.address || null,
                    postalCode: mapped.postalCode || null,
                    website: mapped.website || null,
                    linkedinUrl: mapped.linkedinUrl || null,
                    twitterUrl: mapped.twitterUrl || null,
                    tags,
                    jobTitle: mapped.jobTitle || null,
                    score,
                    lifecycleStage: mapped.lifecycleStage || null,
                    updatedAt: new Date(),
                  })
                  .where(eq(contacts.id, existing.id));
                results.updated++;
                continue;
              }
            }
          }

          insertBuffer.push({
            tenantId: ctx.tenantId,
            createdBy: ctx.userId,
            assignedTo: mapped.assignedTo || ctx.userId,
            firstName: mapped.firstName,
            lastName: mapped.lastName || '',
            email: mapped.email?.toLowerCase().trim() || null,
            phone: mapped.phone || null,
            companyId,
            leadStatus,
            leadSource: mapped.leadSource || null,
            notes: mapped.notes?.slice(0, 5000) || null,
            city: mapped.city || null,
            country: mapped.country || null,
            state: mapped.state || null,
            address: mapped.address || null,
            postalCode: mapped.postalCode || null,
            website: mapped.website || null,
            linkedinUrl: mapped.linkedinUrl || null,
            twitterUrl: mapped.twitterUrl || null,
            tags,
            jobTitle: mapped.jobTitle || null,
            score,
            lifecycleStage: mapped.lifecycleStage || null,
          });

          if (insertBuffer.length >= BATCH_SIZE) {
            await tx.insert(contacts).values(insertBuffer);
            results.imported += insertBuffer.length;
            insertBuffer.length = 0;
          }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (rowErr: any) {
          results.errors.push(`Row ${index+2}: ${rowErr.message}`);
          results.skipped++;
        }
      }

      if (insertBuffer.length > 0) {
        await tx.insert(contacts).values(insertBuffer);
        results.imported += insertBuffer.length;
      }

      // Update contact counter
      if (results.imported > 0) {
        await tx
          .update(tenants)
          .set({
            currentContacts: sql`${tenants.currentContacts} + ${results.imported}`,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, ctx.tenantId));
      }

      // Log activity
      await tx.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        eventType: 'contact_created',
        description: `Imported ${results.imported} contacts (${results.updated} updated, ${results.skipped} skipped)`,
        entityType: 'bulk_import',
        entityId: sql`gen_random_uuid()`,
        action: 'import_completed',
      });
    });

    return NextResponse.json({ ok:true, results });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[contacts import POST]', err);
    return apiError(err);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { importSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, leadActivities, activities } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveOrCreateContactForLead } from '@/lib/contacts/resolve';
import { generateLeadOid } from '@/lib/leads/oid';

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

// Map CSV headers to leads table columns
const LEAD_COLUMN_MAP: Record<string, string> = {
  // Names
  'first_name': 'firstName', 'firstname': 'firstName', 'first name': 'firstName',
  'last_name': 'lastName', 'lastname': 'lastName', 'last name': 'lastName', 'surname': 'lastName',
  'full_name': 'fullName', 'fullname': 'fullName', 'name': 'firstName',
  // Contact
  'email': 'email', 'email_address': 'email', 'emailaddress': 'email',
  'phone': 'phone', 'phone_number': 'phone', 'mobile': 'mobile', 'telephone': 'phone',
  // Title & Department
  'job_title': 'title', 'title': 'title', 'position': 'title', 'role': 'title',
  'department': 'department', 'dept': 'department',
  // Company
  'company_name': 'companyName', 'company': 'companyName', 'organization': 'companyName', 'org': 'companyName',
  'company_size': 'companySize', 'companysize': 'companySize', 'company size': 'companySize', 'size': 'companySize',
  'company_industry': 'companyIndustry', 'industry': 'companyIndustry',
  'company_website': 'website', 'companywebsite': 'website',
  'company_annual_revenue': 'value', 'annualrevenue': 'value', 'revenue': 'value',
  // Lead info
  'lead_source': 'source', 'source': 'source',
  'lead_status': 'leadStatus', 'status': 'leadStatus',
  'lifecycle_stage': 'lifecycleStage', 'stage': 'lifecycleStage',
  'score': 'score', 'rating': 'score', 'lead_score': 'score',
  // BANT
  'budget': 'budget', 'budget_amount': 'budget',
  'budget_currency': 'budgetCurrency', 'currency': 'budgetCurrency',
  'authority_level': 'authorityLevel', 'authority': 'authorityLevel',
  'need_description': 'needDescription', 'need': 'needDescription', 'pain_point': 'needDescription', 'painpoint': 'needDescription',
  'timeline': 'timeline', 'purchase_timeline': 'timeline', 'timeline_target_date': 'timelineTargetDate',
  // Product
  'product_id': 'productId', 'product': 'productId',
  // Assignment
  'assigned_to': 'assignedTo', 'owner': 'assignedTo', 'owner_id': 'assignedTo',
  // Address
  'country': 'country', 'state': 'state', 'province': 'state', 'region': 'state',
  'city': 'city', 'postal_code': 'postalCode', 'zipcode': 'postalCode', 'zip': 'postalCode',
  'address_line1': 'addressLine1', 'address': 'addressLine1', 'street': 'addressLine1',
  // Social & Web
  'website': 'website', 'url': 'website',
  'linkedin_url': 'linkedinUrl', 'linkedin': 'linkedinUrl',
  'twitter_handle': 'twitterHandle', 'twitter': 'twitterHandle',
  'facebook_url': 'facebookUrl', 'facebook': 'facebookUrl',
  // UTM & Tracking
  'utm_source': 'utmSource', 'utm_medium': 'utmMedium', 'utm_campaign': 'utmCampaign',
  // Other
  'notes': 'internalNotes', 'note': 'internalNotes', 'description': 'internalNotes', 'comments': 'internalNotes',
  'internal_notes': 'internalNotes', 'internalnotes': 'internalNotes',
  'tags': 'tags', 'tag': 'tags',
};

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost', 'nurturing'];
const VALID_LIFECYCLES = ['visitor', 'lead', 'marketing_qualified_lead', 'sales_qualified_lead', 'opportunity', 'customer', 'evangelist'];
const VALID_AUTHORITY = ['decision_maker', 'influencer', 'user', 'unknown'];

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'lead_csv_import', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'leads.import' as string);
    if (deny) return deny;

    const rawBody = await request.json();
    const validated = validateBody(importSchema, rawBody);
    if (validated instanceof NextResponse) return validated;

    const { skipDuplicates = true, updateExisting = false } = rawBody;
    const csv = rawBody.csv;
    if (!csv) return NextResponse.json({ error: 'csv field required' }, { status: 400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    if (rows.length > 50000) return NextResponse.json({ error: 'CSV too large (max 50,000 rows)' }, { status: 400 });

    const results = {
      imported: 0,
      updated: 0,
      skipped: 0,
      newContacts: 0,
      mergedContacts: 0,
      errors: [] as string[],
    };

    for (const [index, row] of rows.entries()) {
      try {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: any = {};
        for (const [key, val] of Object.entries(row)) {
          const dbCol = LEAD_COLUMN_MAP[key.toLowerCase().trim()];
          if (dbCol && val) mapped[dbCol] = val;
        }

        const firstName = mapped.firstName?.trim();
        if (!firstName) {
          results.errors.push(`Row ${index + 2}: first_name is required`);
          results.skipped++;
          continue;
        }

        const email = mapped.email?.toLowerCase().trim() || null;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.errors.push(`Row ${index + 2}: invalid email "${email}"`);
          results.skipped++;
          continue;
        }

        const leadStatus = VALID_STATUSES.includes(mapped.leadStatus) ? mapped.leadStatus : 'new';
        const lifecycle = VALID_LIFECYCLES.includes(mapped.lifecycleStage) ? mapped.lifecycleStage : 'lead';
        const authority = VALID_AUTHORITY.includes(mapped.authorityLevel) ? mapped.authorityLevel : 'unknown';
        const tags = mapped.tags ? mapped.tags.split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [];
        const scoreVal = mapped.score ? Math.min(100, Math.max(0, parseInt(mapped.score) || 0)) : 0;
        const budgetVal = mapped.budget ? mapped.budget.toString() : null;
        const valueVal = mapped.value ? mapped.value.toString() : null;

        // ── Existing-lead handling: dedupe / update / skip ────────────────
        if (email) {
          const [existing] = await db
            .select({ id: leads.id })
            .from(leads)
            .where(and(
              eq(leads.tenantId, ctx.tenantId),
              eq(sql`lower(${leads.email})`, email),
              sql`${leads.deletedAt} IS NULL`,
            ))
            .limit(1);

          if (existing) {
            if (skipDuplicates && !updateExisting) {
              results.skipped++;
              continue;
            }
            if (updateExisting) {
              await db
                .update(leads)
                .set({
                  firstName,
                  lastName: mapped.lastName || '',
                  phone: mapped.phone || null,
                  mobile: mapped.mobile || null,
                  title: mapped.title || null,
                  companyName: mapped.companyName || null,
                  companySize: mapped.companySize || null,
                  companyIndustry: mapped.companyIndustry || null,
                  leadStatus,
                  lifecycleStage: lifecycle,
                  score: scoreVal,
                  budget: budgetVal,
                  budgetCurrency: mapped.budgetCurrency || 'USD',
                  authorityLevel: authority,
                  needDescription: mapped.needDescription?.slice(0, 5000) || null,
                  timeline: mapped.timeline || null,
                  productId: mapped.productId || null,
                  country: mapped.country || null,
                  city: mapped.city || null,
                  state: mapped.state || null,
                  postalCode: mapped.postalCode || null,
                  addressLine1: mapped.addressLine1 || null,
                  website: mapped.website || null,
                  linkedinUrl: mapped.linkedinUrl || null,
                  twitterHandle: mapped.twitterHandle || null,
                  tags,
                  internalNotes: mapped.internalNotes?.slice(0, 5000) || null,
                  value: valueVal,
                  updatedAt: new Date(),
                })
                .where(eq(leads.id, existing.id));
              results.updated++;
              continue;
            }
          }
        }

        // ── New-lead path: resolve-or-create contact + insert lead, atomic per row ─
        await db.transaction(async (tx) => {
          const resolve = await resolveOrCreateContactForLead(tx, ctx.tenantId, ctx.userId, {
            firstName,
            lastName: mapped.lastName || '',
            email,
            phone: mapped.phone || null,
            title: mapped.title || null,
            companyName: mapped.companyName || null,
            companyIndustry: mapped.companyIndustry || null,
            website: mapped.website || null,
            source: mapped.source || 'csv_import',
            score: scoreVal,
            tags,
            country: mapped.country || null,
            city: mapped.city || null,
            linkedinUrl: mapped.linkedinUrl || null,
            internalNotes: mapped.internalNotes?.slice(0, 5000) || null,
            assignedTo: mapped.assignedTo || null,
          });

          const leadOid = await generateLeadOid(tx, ctx.tenantId);

          const [inserted] = await tx.insert(leads).values({
            tenantId: ctx.tenantId,
            createdBy: ctx.userId,
            assignedTo: mapped.assignedTo || null,
            firstName,
            lastName: mapped.lastName || '',
            email,
            phone: mapped.phone || null,
            mobile: mapped.mobile || null,
            title: mapped.title || null,
            companyId: resolve.companyId,
            companyName: mapped.companyName || null,
            companySize: mapped.companySize || null,
            companyIndustry: mapped.companyIndustry || null,
            source: mapped.source || 'csv_import',
            leadStatus,
            lifecycleStage: lifecycle,
            score: scoreVal,
            budget: budgetVal,
            budgetCurrency: mapped.budgetCurrency || 'USD',
            authorityLevel: authority,
            needDescription: mapped.needDescription?.slice(0, 5000) || null,
            timeline: mapped.timeline || null,
            country: mapped.country || null,
            state: mapped.state || null,
            city: mapped.city || null,
            addressLine1: mapped.addressLine1 || null,
            postalCode: mapped.postalCode || null,
            website: mapped.website || null,
            linkedinUrl: mapped.linkedinUrl || null,
            twitterHandle: mapped.twitterHandle || null,
            utmSource: mapped.utmSource || null,
            utmMedium: mapped.utmMedium || null,
            utmCampaign: mapped.utmCampaign || null,
            tags,
            internalNotes: mapped.internalNotes?.slice(0, 5000) || null,
            value: valueVal,
            contactId: resolve.contactId,
            leadOid,
            productId: mapped.productId || null,
          }).returning({ id: leads.id });

          if (!inserted) throw new Error('Insert returned no row');

          await tx.insert(leadActivities).values({
            tenantId: ctx.tenantId,
            leadId: inserted.id,
            performedBy: ctx.userId,
            activityType: 'created',
            description: 'Lead imported from CSV',
            activityData: { lead_oid: leadOid, contact_id: resolve.contactId, is_new_contact: resolve.isNewContact, source: 'csv_import' },
          });

          await tx.insert(activities).values({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            contactId: resolve.contactId,
            entityType: 'lead',
            entityId: inserted.id,
            eventType: 'lead_created',
            action: 'create',
            description: `Lead ${leadOid} imported from CSV${resolve.isNewContact ? ' (new contact)' : ' (linked to existing contact)'}`,
            metadata: { lead_oid: leadOid, source: 'csv_import' },
          });

          if (resolve.isNewContact) results.newContacts++;
          else results.mergedContacts++;
        });

        results.imported++;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (rowErr: any) {
        results.errors.push(`Row ${index + 2}: ${rowErr.message}`);
        results.skipped++;
      }
    }

    // Log activity
    await db.insert(activities).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: 'lead_created',
      description: `Imported ${results.imported} leads (${results.updated} updated, ${results.skipped} skipped)`,
      entityType: 'bulk_import',
      entityId: sql`gen_random_uuid()`,
      action: 'import_completed',
    });
    return NextResponse.json({ ok: true, results });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[leads/import]', err);
    return apiError(err);
  }
}

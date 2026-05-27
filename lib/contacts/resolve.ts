/**
 * Resolve-or-create helper for the lead → contact attach flow.
 *
 * The CRM model is "one person → one contact → many leads". Every lead
 * intake (manual create, CSV import, public form, chat-to-lead, etc.)
 * funnels through this helper so the lead is linked to a contact at
 * creation time, not at conversion time.
 *
 * Behavior:
 *  - If `lead.email` is provided AND a non-deleted contact with the same
 *    email exists in the tenant → return that contact's id (and minimally
 *    enrich the contact with phone/jobTitle/company/score if blank).
 *  - Otherwise create a new contact populated from the lead fields and
 *    return its id.
 *
 * The caller is responsible for:
 *  - Setting `lead.contact_id = result.contactId` on the lead row
 *  - Emitting any audit / webhook side effects
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { contacts, companies } from '@/drizzle/schema';
import type { db as dbType } from '@/drizzle/db';

export interface ResolveLeadInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  companyName?: string | null;
  companyId?: string | null;
  companyIndustry?: string | null;
  website?: string | null;
  source?: string | null;
  score?: number | null;
  tags?: string[] | null;
  country?: string | null;
  city?: string | null;
  linkedinUrl?: string | null;
  internalNotes?: string | null;
  assignedTo?: string | null;
}

export interface ResolveResult {
  contactId: string;
  companyId: string | null;
  isNewContact: boolean;
}

/**
 * Resolve company by name within the tenant; create if not found.
 * Returns null if no companyName provided.
 */
export async function resolveOrCreateCompany(
  tx: typeof dbType,
  tenantId: string,
  userId: string,
  lead: Pick<ResolveLeadInput, 'companyName' | 'companyId' | 'companyIndustry' | 'website'>,
): Promise<string | null> {
  if (lead.companyId) return lead.companyId;
  const name = lead.companyName?.trim();
  if (!name) return null;

  const existing = await tx.query.companies.findFirst({
    where: and(
      eq(companies.tenantId, tenantId),
      sql`lower(${companies.name}) = lower(${name})`,
      isNull(companies.deletedAt),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [created] = await tx
    .insert(companies)
    .values({
      tenantId,
      name,
      industry: lead.companyIndustry || null,
      website: lead.website || null,
      createdBy: userId,
    })
    .returning({ id: companies.id });

  return created?.id ?? null;
}

/**
 * Resolve-or-create the contact a new lead should be attached to.
 *
 * Email is the dedup key (lower-cased + trimmed). When merging into an
 * existing contact we DON'T overwrite fields the contact already has —
 * we only fill blanks and bump score upward.
 */
export async function resolveOrCreateContactForLead(
  tx: typeof dbType,
  tenantId: string,
  userId: string,
  lead: ResolveLeadInput,
): Promise<ResolveResult> {
  const companyId = await resolveOrCreateCompany(tx, tenantId, userId, lead);

  // 1. Try email-dedup against existing contacts.
  const email = lead.email?.toLowerCase().trim() || null;
  if (email) {
    const existing = await tx.query.contacts.findFirst({
      where: and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.email, email),
        isNull(contacts.deletedAt),
      ),
      columns: { id: true, score: true, phone: true, jobTitle: true, companyId: true, linkedinUrl: true },
    });

    if (existing) {
      // Minimal enrichment: only fill blanks + lift score upward. Never overwrite.
      const patch: Record<string, unknown> = {};
      if (!existing.phone && lead.phone) patch['phone'] = lead.phone;
      if (!existing.jobTitle && lead.title) patch['jobTitle'] = lead.title;
      if (!existing.companyId && companyId) patch['companyId'] = companyId;
      if (!existing.linkedinUrl && lead.linkedinUrl) patch['linkedinUrl'] = lead.linkedinUrl;
      if ((lead.score ?? 0) > (existing.score ?? 0)) patch['score'] = lead.score ?? 0;
      if (Object.keys(patch).length > 0) {
        patch['updatedAt'] = new Date();
        await tx.update(contacts).set(patch as any).where(eq(contacts.id, existing.id));
      }
      return { contactId: existing.id, companyId, isNewContact: false };
    }
  }

  // 2. No match — create a fresh contact populated from the lead.
  const [created] = await tx
    .insert(contacts)
    .values({
      tenantId,
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      email: email,
      phone: lead.phone || null,
      jobTitle: lead.title || null,
      companyId,
      leadStatus: 'new',
      leadSource: lead.source || 'lead',
      lifecycleStage: 'lead',
      score: lead.score ?? 0,
      tags: lead.tags ?? [],
      country: lead.country || null,
      city: lead.city || null,
      linkedinUrl: lead.linkedinUrl || null,
      assignedTo: (lead.assignedTo as any) || null,
      createdBy: userId,
      notes: lead.internalNotes || null,
    })
    .returning({ id: contacts.id });

  if (!created) throw new Error('Failed to create contact during lead intake');
  return { contactId: created.id, companyId, isNewContact: true };
}

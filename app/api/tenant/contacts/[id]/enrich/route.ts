/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

/**
 * POST /api/tenant/contacts/:id/enrich
 * Enrich a contact with additional data from external sources.
 *
 * Currently uses a simple heuristic enrichment:
 * - Generates LinkedIn URL from name + company
 * - Estimates company domain from email
 * - Adds timezone guess from phone country code
 *
 * Future: integrate with Clearbit, Apollo, ZoomInfo APIs.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(request, 'contact-enrich', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id } = await params;

    // Fetch contact
    const [contact] = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        metadata: contacts.metadata,
      })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
      .limit(1);

    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    // Enrich with heuristic data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enriched: Record<string, any> = {};

    // Extract company domain from email
    if (contact.email && contact.email.includes('@')) {
      const domain = contact.email.split('@')[1];
      if (domain && !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'].includes(domain)) {
        enriched.company_domain = domain;
        enriched.company_website = `https://${domain}`;
      }
    }

    // Generate LinkedIn search URL
    if (contact.firstName || contact.lastName) {
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
      enriched.linkedin_search_url = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(name)}`;
    }

    // Timezone guess from phone prefix
    if (contact.phone) {
      const phone = contact.phone.replace(/\D/g, '');
      if (phone.startsWith('1')) enriched.timezone_guess = 'America/New_York';
      else if (phone.startsWith('44')) enriched.timezone_guess = 'Europe/London';
      else if (phone.startsWith('91')) enriched.timezone_guess = 'Asia/Kolkata';
      else if (phone.startsWith('61')) enriched.timezone_guess = 'Australia/Sydney';
      else if (phone.startsWith('49')) enriched.timezone_guess = 'Europe/Berlin';
    }

    enriched.enriched_at = new Date().toISOString();
    enriched.enrichment_source = 'heuristic';

    // Merge into metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingMeta = (contact.metadata as Record<string, any>) || {};
    const newMeta = { ...existingMeta, enrichment: enriched };

    await db
      .update(contacts)
      .set({ metadata: newMeta, updatedAt: new Date() })
      .where(eq(contacts.id, id));

    return NextResponse.json({
      data: { enriched, contact_id: id },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

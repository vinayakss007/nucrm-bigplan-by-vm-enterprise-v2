/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { quotes } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quotes', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    // #1133 (+ #1913): the old x-portal-email header was spoofable — anyone
    // could read any customer's quotes by setting it. Identity comes from
    // resolvePortalIdentity(): a validated x-portal-token header or the
    // httpOnly portal session cookie (sent automatically by browser fetch).
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // #2446: both reads below sit on tables whose only policy compares
    // `tenant_id` to `app.current_tenant`, and this route set nothing — so the
    // contact lookup returned nothing, the handler took its `!contact` exit, and
    // a customer with quotes was served `{"data":[]}`. The credential names the
    // tenant, so the tenant the credential names is also the RLS context, and
    // everything under it runs on that transaction's `tx` (a bare `db.*` inside
    // the callback would go back to the pool and lose the GUC — see
    // lib/db/tenant-carrier.ts). NO_USER_SENTINEL: there is no CRM user behind a
    // portal call.
    const data = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return [];

      return tx
        .select({
          id: quotes.id,
          quote_number: quotes.quoteNumber,
          title: quotes.title,
          status: quotes.status,
          subtotal: quotes.subtotal,
          discount: quotes.discount,
          tax: quotes.tax,
          total_amount: quotes.totalAmount,
          expires_at: quotes.expiresAt,
          notes: quotes.notes,
          terms: quotes.terms,
          sent_at: quotes.sentAt,
          accepted_at: quotes.acceptedAt,
          declined_at: quotes.declinedAt,
          created_at: quotes.createdAt,
          metadata: quotes.metadata,
        })
        .from(quotes)
        .where(and(eq(quotes.tenantId, contact.tenantId), eq(quotes.contactId, contact.id), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.createdAt))
        .limit(50);
    });

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}

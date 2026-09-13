/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { quotes, contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolvePortalIdentity } from '@/lib/portal-auth';

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quotes', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    // #1133 (+ #1913): the old x-portal-email header was spoofable — anyone
    // could read any customer's quotes by setting it. Identity comes from
    // resolvePortalIdentity(): a validated x-portal-token header or the
    // httpOnly portal session cookie (sent automatically by browser fetch).
    const portalClient = await resolvePortalIdentity(request);
    if (!portalClient) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const contact = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.email, portalClient.email),
        eq(contacts.tenantId, portalClient.tenantId),
      ),
      columns: { id: true, tenantId: true },
    });

    if (!contact) return NextResponse.json({ data: [] });

    const data = await db
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

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}

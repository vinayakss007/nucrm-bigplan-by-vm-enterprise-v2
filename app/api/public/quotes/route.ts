/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { quotes, contacts, portalClients } from '@/drizzle/schema';
import { eq, and, desc, isNull, gt } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quotes', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    // #1133: the old x-portal-email header was spoofable — anyone could read
    // any customer's quotes by setting it. Require a valid portal access token
    // (issued via /api/tenant/portal/login) and derive the email/tenant from
    // the authenticated portal client instead of trusting a request header.
    const token = request.headers.get('x-portal-token');
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const [portalClient] = await db
      .select({ email: portalClients.email, tenantId: portalClients.tenantId })
      .from(portalClients)
      .where(and(
        eq(portalClients.accessToken, token),
        eq(portalClients.isActive, true),
        gt(portalClients.expiresAt, new Date()),
      ))
      .limit(1);

    if (!portalClient) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
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

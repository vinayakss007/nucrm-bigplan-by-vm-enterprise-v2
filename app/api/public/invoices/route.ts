/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { invoices } from '@/drizzle/schema';
import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';
import { logError } from '@/lib/errors-server';

const VISIBLE_STATUSES = ['sent', 'paid', 'overdue', 'partially_paid'];

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-invoices', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    // #2439: the customer is whoever their credential says they are. This was
    // the last identity-taken-from-a-query-parameter left in app/api/public/**
    // — `?email=` let any caller name an address and read that account's
    // invoice totals, because the tenant was derived from the contact the email
    // happened to resolve to rather than from the caller (#1133 / #1913 fixed
    // the quotes and ticket routes and never reached this one).
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // The tenant the credential names is also the RLS context both reads need:
    // `contacts` and `invoices` carry a tenant_isolation policy comparing
    // tenant_id to app.current_tenant, and a public route running on the bare
    // pool never sets it — so they abort (#2438) or silently match zero rows
    // (#2446). There is no CRM user behind a portal call, hence NO_USER_SENTINEL.
    const data = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return [];

      // Only return invoices that have been explicitly sent or paid (never draft/cancelled).
      // Only expose fields safe for public consumption — no internal notes, no payment
      // references, no created_by / updated_by identifiers.
      return tx.select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        balanceDue: invoices.balanceDue,
        currency: invoices.currency,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        paidAt: invoices.paidAt,
      })
        .from(invoices)
        .where(and(
          eq(invoices.tenantId, contact.tenantId),
          eq(invoices.contactId, contact.id),
          isNull(invoices.deletedAt),
          // Only show invoices that have been sent to the client
          inArray(invoices.status, VISIBLE_STATUSES),
        ))
        .orderBy(desc(invoices.createdAt))
        .limit(50);
    });

    return NextResponse.json({ data });
  } catch (err) {
    // #2439: the old `catch { return { data: [] } }` turned every failure — a
    // missing column, an RLS refusal, a dead pool — into a well-formed empty
    // list, which is how an unreadable portal stayed invisible for this long.
    void logError({
      error: err,
      context: 'public/invoices',
      level: 'warning',
      requestUrl: request.nextUrl.pathname,
      requestMethod: 'GET',
    });
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 });
  }
}

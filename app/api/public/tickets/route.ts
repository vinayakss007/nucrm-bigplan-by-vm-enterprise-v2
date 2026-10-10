/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { supportTickets, contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { uuidIdSchemaWith } from '@/lib/validation/uuid';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';
import { PUBLIC_TICKET_COLUMNS } from '@/lib/public-ticket-projection';

const publicTicketSchema = z.object({
  email: z.string().email('Valid email is required'),
  subject: z.string().min(1, 'Subject is required').max(300),
  body: z.string().max(10000).optional().default(''),
  category: z.string().max(100).optional().default('general'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  // Tenant context for ANONYMOUS embeds (#1982). A bare email lookup can match
  // a contact in another tenant, filing the ticket under the wrong workspace. A
  // logged-in portal caller (session cookie / x-portal-token) never needs this —
  // the tenant is derived from their server-validated identity and any body
  // value is ignored.
  tenant_id: uuidIdSchemaWith('tenant_id is required').optional(),
});

/**
 * Public ticket list — the httpOnly portal session cookie, or an
 * `x-portal-token` holding a `portal_clients` access token (both read by
 * `resolvePortalIdentity()`; portal UI sends the cookie automatically).
 *
 * The per-ticket `support_tickets.portal_token` branch that used to sit here is
 * gone (#2444): it resolved one ticket's credential to that contact's *whole*
 * ticket history (#2378's deliberate broadening), it was never delivered to
 * anyone since #2440 stopped echoing it, and nothing could revoke it. What
 * remains is the credential this product does have a lifecycle for.
 *
 * The old x-portal-email header auth was spoofable and has been removed.
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-tickets-list', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    // The only authority left on this surface (#2444): `resolvePortalIdentity()`
    // accepts the httpOnly portal session cookie or an `x-portal-token` that is a
    // `portal_clients` access token — one family, one header, so the overload #2444
    // documented is gone with the branch above it. Identity is server-validated, and
    // the contact lookup is scoped to (email, tenantId) — no cross-tenant mixing.
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // #2446: `contacts` and `support_tickets` are both policy-bound, so the
    // contact lookup and the list have to share one tenant-scoped transaction —
    // a bare `db.*` here would run on the pool connection and read as nobody.
    // #2438 is the reason `!contact` still answers `{ data: [] }` rather than
    // throwing: with the context established, an empty list really does mean the
    // customer has no tickets.
    const data = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {
      const contact = await resolvePortalContact(identity, tx);
      if (!contact) return [];
      // #2443: the same named projection the detail handler uses, so a customer's
      // list and their ticket page cannot disagree about the shape of a ticket.
      return tx.select(PUBLIC_TICKET_COLUMNS)
        .from(supportTickets)
        .where(and(
          eq(supportTickets.tenantId, contact.tenantId),
          eq(supportTickets.contactId, contact.id),
          isNull(supportTickets.deletedAt),
        ))
        .orderBy(desc(supportTickets.createdAt))
        .limit(50);
    });

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}

/**
 * Public ticket creation — logged-in portal callers are identified by their
 * session (cookie/token); anonymous embeds must pass tenant_id in the body.
 * The response is the new ticket only, in the columns named on the insert below
 * (#2440). Since #2444 nothing is minted at all: there is no credential in this
 * response to leak, because the per-ticket credential that used to be written has
 * been retired. Portal access for a real customer comes from
 * /api/tenant/portal/login (httpOnly session) or a `portal_clients` access token,
 * both of which expire and can be deactivated.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-tickets-create', max: 10, windowMinutes: 1 });
    if (limited) return limited;

    const raw = await readJsonBody(request);
    const parsed = validateBody(publicTicketSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { email, subject, body, category, priority } = parsed.data;

    // Logged-in portal caller: tenant+email come from the server-validated
    // identity — body values can't spoof another workspace (#1982).
    const identity = await resolvePortalIdentity(request);

    let tenant_id = parsed.data.tenant_id;
    let lookupEmail = email;
    if (identity) {
      tenant_id = identity.tenantId;
      lookupEmail = identity.email;
    }
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }
    const scopedTenantId = tenant_id;

    // #2446: the contact read and the insert are one tenant-scoped transaction.
    // They were already the same two statements; what they lacked was a context,
    // so the contact resolved to nobody (404 "No account found") for a real
    // customer, and an anonymous embed that somehow got past it would have
    // inserted on the pool connection with `app.current_tenant` unset — a row
    // `support_tickets`' own FOR ALL policy refuses, which is how every public
    // ticket in this issue's measurement failed to file.
    //
    // The context is the tenant the RESOLVED CONTACT belongs to. `tenant_id`
    // names the workspace to look in (that is #1982's deliberate contract for
    // anonymous embeds); `contact.tenantId`, which is what the insert stamps, is
    // read out of the row that lookup returned, so the caller's field can widen
    // nothing it does not already have an account in.
    const ticket = await withTenantContext(scopedTenantId, NO_USER_SENTINEL, async (tx) => {
      // Find or create contact — ALWAYS scoped to (tenantId, email) (#1982), and
      // never to a tombstoned one (#2382): deleting the customer ends their portal
      // access, so "No account found with this email" is the right answer.
      const contact = await tx.query.contacts.findFirst({
        where: and(
          eq(contacts.tenantId, scopedTenantId),
          eq(contacts.email, lookupEmail),
          isNull(contacts.deletedAt),
        ),
        // #2457: `columns` is what keeps this from being SELECT * of a 55-column
        // row (measured on the live database) for an anonymous caller. Only `id`
        // and `tenantId` are read below, and both are used to scope the insert —
        // the same pair `resolvePortalContact` already projects.
        columns: { id: true, tenantId: true },
      });

      if (!contact) return null;

      // #2444: no token is minted here any more. This insert used to write a
      // `portal_token` on every ticket, and the GET handlers read it back as a
      // bearer credential that expired never, revoked never and — since #2440
      // stopped echoing it — was delivered to nobody. `support_tickets.portal_token`
      // is nullable as of 0124, so a ticket is now simply a ticket.
      //
      // #2440's other half still applies and is the reason the column list below
      // is written out: `.returning()`-ing the whole row would ship every column
      // the table grows, including the retired `portal_token` values that still sit
      // on pre-#2442 rows.
      const [row] = await tx.insert(supportTickets).values({
        tenantId: contact.tenantId,
        contactId: contact.id,
        subject,
        body,
        category,
        priority,
        status: 'open',
      }).returning({
        id: supportTickets.id,
        subject: supportTickets.subject,
        status: supportTickets.status,
        priority: supportTickets.priority,
        category: supportTickets.category,
        createdAt: supportTickets.createdAt,
      });

      return row;
    });

    if (!ticket) return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });

    return NextResponse.json({ data: ticket }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}

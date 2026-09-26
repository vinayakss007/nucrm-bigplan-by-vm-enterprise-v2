/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, contacts } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';
import { generatePortalToken } from '@/lib/ticket-portal';
import { resolvePortalIdentity, resolvePortalContact } from '@/lib/portal-auth';

const publicTicketSchema = z.object({
  email: z.string().email('Valid email is required'),
  subject: z.string().min(1, 'Subject is required').max(300),
  body: z.string().max(10000).optional().default(''),
  category: z.string().max(100).optional().default('general'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  // Tenant context for ANONYMOUS embeds (#1982). A bare email lookup can match
  // a contact in another tenant, filing the ticket (and issuing a portal
  // token) under the wrong workspace. A logged-in portal caller (session
  // cookie / x-portal-token) never needs this — the tenant is derived from
  // their server-validated identity and any body value is ignored.
  tenant_id: z.string().uuid('tenant_id is required').optional(),
});

/**
 * Public ticket list — x-portal-token header (per-ticket token) OR the
 * httpOnly portal session cookie (portal UI; sent automatically).
 * The old x-portal-email header auth was spoofable and has been removed.
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-tickets-list', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    let tenantId: string;
    let contactId: string;

    const token = request.headers.get('x-portal-token');
    if (token) {
      // Validate the token — find the ticket it belongs to, then list all tickets for that contact
      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.portalToken, token),
        columns: { contactId: true, tenantId: true },
      });

      if (!ticket || !ticket.contactId) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }
      tenantId = ticket.tenantId;
      contactId = ticket.contactId;
    } else {
      // Cookie-session path (portal UI): identity is server-validated, and the
      // contact lookup is scoped to (email, tenantId) — no cross-tenant mixing.
      const identity = await resolvePortalIdentity(request);
      if (!identity) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      const contact = await resolvePortalContact(identity);
      if (!contact) return NextResponse.json({ data: [] });
      tenantId = contact.tenantId;
      contactId = contact.id;
    }

    const data = await db.select({
      id: supportTickets.id, subject: supportTickets.subject,
      body: supportTickets.body, status: supportTickets.status,
      priority: supportTickets.priority, category: supportTickets.category,
      created_at: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.contactId, contactId)))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}

/**
 * Public ticket creation — logged-in portal callers are identified by their
 * session (cookie/token); anonymous embeds must pass tenant_id in the body.
 * Returns the portal_token in the response so the client can use it for future access.
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

    // Find or create contact — ALWAYS scoped to (tenantId, email) (#1982).
    const contact = await db.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, tenant_id), eq(contacts.email, lookupEmail)),
    });

    if (!contact) return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });

    const portalToken = generatePortalToken();

    const [ticket] = await db.insert(supportTickets).values({
      tenantId: contact.tenantId,
      contactId: contact.id,
      subject,
      body,
      category,
      priority,
      status: 'open',
      portalToken,
    }).returning();

    return NextResponse.json({ data: ticket }, { status: 201 });
 
 
  } catch (err) {
    return apiError(err);
  }
}

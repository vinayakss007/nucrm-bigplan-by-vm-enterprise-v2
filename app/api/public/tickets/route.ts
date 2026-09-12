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

const publicTicketSchema = z.object({
  email: z.string().email('Valid email is required'),
  subject: z.string().min(1, 'Subject is required').max(300),
  body: z.string().max(10000).optional().default(''),
  category: z.string().max(100).optional().default('general'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  // Tenant context is REQUIRED (#1982). A bare email lookup can match a
  // contact in another tenant, filing the ticket (and issuing a portal
  // token) under the wrong workspace. Embeds must pass their tenant id.
  tenant_id: z.string().uuid('tenant_id is required'),
});

/**
 * Public ticket list — requires x-portal-token header.
 * Token is a 32-char opaque string generated when the ticket was created.
 * The old x-portal-email header auth was spoofable and has been removed.
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-tickets-list', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const token = request.headers.get('x-portal-token');
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Validate the token — find the ticket it belongs to, then list all tickets for that contact
    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.portalToken, token),
      columns: { contactId: true, tenantId: true },
    });

    if (!ticket || !ticket.contactId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const data = await db.select({
      id: supportTickets.id, subject: supportTickets.subject,
      body: supportTickets.body, status: supportTickets.status,
      priority: supportTickets.priority, category: supportTickets.category,
      created_at: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.tenantId, ticket.tenantId), eq(supportTickets.contactId, ticket.contactId)))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}

/**
 * Public ticket creation — requires email in body to find/create contact.
 * Returns the portal_token in the response so the client can use it for future access.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-tickets-create', max: 10, windowMinutes: 1 });
    if (limited) return limited;

    const raw = await readJsonBody(request);
    const parsed = validateBody(publicTicketSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { email, subject, body, category, priority, tenant_id } = parsed.data;

    // Find or create contact — ALWAYS scoped to (tenantId, email) (#1982).
    const contact = await db.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, tenant_id), eq(contacts.email, email)),
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

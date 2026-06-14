import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, contacts } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const publicTicketSchema = z.object({
  email: z.string().email('Valid email is required'),
  subject: z.string().min(1, 'Subject is required').max(300),
  body: z.string().max(10000).optional().default(''),
  category: z.string().max(100).optional().default('general'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
});

// Public ticket endpoint - uses email to identify the user
export async function GET(request: NextRequest) {
  try {
    const email = request.headers.get('x-portal-email') || request.nextUrl.searchParams.get('email');
    if (!email) return NextResponse.json({ data: [] });

    // Find contact by email
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
      columns: { id: true, tenantId: true }
    });

    if (!contact) return NextResponse.json({ data: [] });

    const data = await db.select({
      id: supportTickets.id, subject: supportTickets.subject,
      body: supportTickets.body, status: supportTickets.status,
      priority: supportTickets.priority, category: supportTickets.category,
      created_at: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.tenantId, contact.tenantId), eq(supportTickets.contactId, contact.id)))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const parsed = validateBody(publicTicketSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { email, subject, body, category, priority } = parsed.data;

    // Find or create contact
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
    });

    if (!contact) return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });

    const [ticket] = await db.insert(supportTickets).values({
      tenantId: contact.tenantId,
      contactId: contact.id,
      subject,
      body,
      category,
      priority,
      status: 'open',
    }).returning();

    return NextResponse.json({ data: ticket }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

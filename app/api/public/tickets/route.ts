import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, contacts } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

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
    const body = await request.json();
    if (!body.email || !body.subject) {
      return NextResponse.json({ error: 'Email and subject are required' }, { status: 400 });
    }

    // Find or create contact
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, body.email),
    });

    if (!contact) return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });

    const [ticket] = await db.insert(supportTickets).values({
      tenantId: contact.tenantId,
      contactId: contact.id,
      subject: body.subject,
      body: body.body || '',
      category: body.category || 'general',
      priority: body.priority || 'medium',
      status: 'open',
    }).returning();

    return NextResponse.json({ data: ticket }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}

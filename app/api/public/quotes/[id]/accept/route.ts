import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { quotes, contacts, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quote-accept', max: 10, windowMinutes: 1 });
    if (limited) return limited;

    const email = request.headers.get('x-portal-email');
    if (!email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.email, email),
      columns: { id: true, tenantId: true },
    });
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { id } = await params;
    const [quote] = await db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), eq(quotes.tenantId, contact.tenantId), eq(quotes.contactId, contact.id), isNull(quotes.deletedAt)))
      .limit(1);

    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

    const validStatuses = ['sent', 'viewed'];
    if (!validStatuses.includes(quote.status ?? '')) {
      return NextResponse.json({ error: 'Quote cannot be accepted in its current state' }, { status: 409 });
    }

    if (quote.expiresAt && new Date(quote.expiresAt).getTime() < Date.now()) {
      await db.update(quotes).set({ status: 'expired', updatedAt: new Date() }).where(eq(quotes.id, quote.id));
      return NextResponse.json({ error: 'Quote has expired' }, { status: 410 });
    }

    const now = new Date();
    await db
      .update(quotes)
      .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
      .where(eq(quotes.id, quote.id));

    try {
      await db.insert(activities).values({
        tenantId: quote.tenantId,
        userId: null,
        entityType: 'quote',
        entityId: quote.id,
        contactId: contact.id,
        dealId: quote.dealId ?? null,
        eventType: 'offer_accepted',
        description: `Client accepted quote "${quote.title}"`,
        metadata: { quote_id: quote.id, total_amount: quote.totalAmount, accepted_by_email: email },
      });
    } catch (err) {
      console.warn('[portal/quotes/accept] activity insert failed:', (err as Error).message);
    }

    await logAudit({
      tenantId: quote.tenantId,
      action: 'offer_accepted',
      entityType: 'quote',
      entityId: quote.id,
      newData: { accepted_by_email: email },
    });

    return NextResponse.json({ ok: true, status: 'accepted', accepted_at: now.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}

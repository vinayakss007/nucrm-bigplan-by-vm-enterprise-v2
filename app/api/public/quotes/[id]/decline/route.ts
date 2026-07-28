import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { quotes, contacts, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-quote-decline', max: 10, windowMinutes: 1 });
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
      return NextResponse.json({ error: 'Quote cannot be declined in its current state' }, { status: 409 });
    }

    let reason = '';
    try {
      const body = await readJsonBody(request);
      reason = (body.reason ?? '').trim();
    } catch { /* no body is fine */ }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: 'declined', declinedAt: now, updatedAt: now })
        .where(eq(quotes.id, quote.id));

      await tx.insert(activities).values({
        tenantId: quote.tenantId,
        userId: null,
        entityType: 'quote',
        entityId: quote.id,
        contactId: contact.id,
        dealId: quote.dealId ?? null,
        eventType: 'offer_declined',
        description: `Client declined quote "${quote.title}"${reason ? ` — ${reason}` : ''}`,
        metadata: { quote_id: quote.id, decline_reason: reason, email },
      });
    });

    await logAudit({
      tenantId: quote.tenantId,
      action: 'offer_declined',
      entityType: 'quote',
      entityId: quote.id,
      newData: { reason, email },
    });

    return NextResponse.json({ ok: true, status: 'declined', declined_at: now.toISOString() });
  } catch (err) {
    return apiError(err);
  }
}

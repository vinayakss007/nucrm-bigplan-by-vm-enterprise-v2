/**
 * Tenant-side Offers list
 *   GET /api/tenant/offers?status=&contact_id=&deal_id=&page=&pageSize=
 *
 * Reads from `quotes` filtered to "submitted-for-buyer" rows
 * (i.e. those with `metadata.offer.public_token` set or status != 'draft').
 *
 * Returns just enough for the list page; detail goes through /api/tenant/quotes/[id].
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes, contacts } from '@/drizzle/schema';
import { eq, and, desc, sql, count, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

const VALID_STATUSES = new Set(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled']);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const contactId = sp.get('contact_id');
    const dealId = sp.get('deal_id');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '25', 10) || 25));
    const offset = (page - 1) * pageSize;

    const filters = [eq(quotes.tenantId, ctx.tenantId), isNull(quotes.deletedAt)];
    if (status && VALID_STATUSES.has(status)) filters.push(eq(quotes.status, status));
    if (contactId) filters.push(eq(quotes.contactId, contactId));
    if (dealId) filters.push(eq(quotes.dealId, dealId));

    const where = and(...filters);

    const [rows, totalRow, summary] = await Promise.all([
      db
        .select({
          id: quotes.id,
          quote_number: quotes.quoteNumber,
          title: quotes.title,
          status: quotes.status,
          total_amount: quotes.totalAmount,
          expires_at: quotes.expiresAt,
          sent_at: quotes.sentAt,
          accepted_at: quotes.acceptedAt,
          declined_at: quotes.declinedAt,
          contact_id: quotes.contactId,
          deal_id: quotes.dealId,
          created_at: quotes.createdAt,
          metadata: quotes.metadata,
          contact_name: sql<string>`COALESCE(${contacts.firstName} || ' ' || ${contacts.lastName}, '')`,
          contact_email: contacts.email,
        })
        .from(quotes)
        .leftJoin(contacts, eq(quotes.contactId, contacts.id))
        .where(where)
        .orderBy(desc(quotes.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ value: count() }).from(quotes).where(where),
      db
        .select({
          status: quotes.status,
          n: sql<number>`count(*)::int`,
          amount: sql<number>`COALESCE(SUM(${quotes.totalAmount}), 0)::numeric`,
        })
        .from(quotes)
        .where(and(eq(quotes.tenantId, ctx.tenantId), isNull(quotes.deletedAt)))
        .groupBy(quotes.status),
    ]);

    const total = Number(totalRow[0]?.value ?? 0);

    // Build lightweight offer-flavoured rows
    const offers = rows.map(r => {
      const meta = (r.metadata as { offer?: Record<string, unknown> } | null) ?? {};
      const offer = meta.offer ?? {};
      return {
        ...r,
        public_token: (offer as Record<string, unknown>)['public_token'] ?? null,
        sent_to_email: (offer as Record<string, unknown>)['sent_to_email'] ?? null,
        viewed_count: Number((offer as Record<string, unknown>)['viewed_count'] ?? 0),
      };
    });

    return NextResponse.json({
      offers,
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
      summary: summary.reduce((acc, row) => {
        acc[row.status] = { count: Number(row.n), amount: Number(row.amount) };
        return acc;
      }, {} as Record<string, { count: number; amount: number }>),
    });
  } catch (err) {
    return apiError(err);
  }
}

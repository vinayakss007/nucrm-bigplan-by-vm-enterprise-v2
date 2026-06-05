import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createPortalSession } from '@/lib/stripe';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/tenant/billing/stripe
 * Creates a Stripe Customer Portal session for managing billing.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });

    const [tenant] = await db.select({ stripeCustomerId: tenants.stripeCustomerId })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    if (!tenant?.stripeCustomerId) {
      return NextResponse.json({ error: 'No billing account. Please subscribe to a plan first.' }, { status: 404 });
    }

    const session = await createPortalSession(tenant.stripeCustomerId);
    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

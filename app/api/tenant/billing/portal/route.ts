/**
 * POST /api/tenant/billing/portal
 *
 * Creates a Stripe Customer Portal session so the workspace admin can manage
 * payment methods, view invoices, or cancel the subscription. Requires a
 * Stripe customer record (created on first checkout).
 *
 * Response: { url: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  isStripeConfigured,
  stripeFetch,
  StripeNotConfiguredError,
  StripeApiError,
  type StripeBillingPortalSession,
} from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Only workspace admins can manage billing.' }, { status: 403 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Billing is not configured. Contact support.' },
        { status: 503 },
      );
    }

    const [sub] = await db
      .select({ stripeCustomerId: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, ctx.tenantId))
      .limit(1);

    if (!sub?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No active subscription. Upgrade to a paid plan first to access the billing portal.' },
        { status: 404 },
      );
    }

    const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';

    const session = await stripeFetch<StripeBillingPortalSession>('/billing_portal/sessions', {
      method: 'POST',
      params: {
        customer: sub.stripeCustomerId,
        return_url: `${appUrl}/tenant/settings/billing`,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json(
        { error: 'Billing is not configured. Contact support.' },
        { status: 503 },
      );
    }
    if (err instanceof StripeApiError) {
      console.error('[billing/portal] stripe error', err.status, err.message);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('[billing/portal]', err);
    return NextResponse.json({ error: 'Could not open billing portal' }, { status: 500 });
  }
}

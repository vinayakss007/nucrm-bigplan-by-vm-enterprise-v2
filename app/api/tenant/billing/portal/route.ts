/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
  type StripeBillingPortalSession,
} from '@/lib/stripe';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const POST = withApiRoute(async (request: NextRequest) => {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'Billing Portal POST', requestMethod: 'POST' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

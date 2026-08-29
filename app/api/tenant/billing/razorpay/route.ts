/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * POST /api/tenant/billing/razorpay
 *
 * Creates a Razorpay order for the requested plan. The client uses the order ID
 * to open the Razorpay checkout modal. Once payment is captured, the webhook
 * handler activates the subscription.
 *
 * Body: { plan: 'starter'|'growth'|'scale', interval: 'month'|'year' }
 * Response: { orderId, amount, currency, key }
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { isRazorpayConfigured, createOrder, getPlanAmount } from '@/lib/razorpay';
import { z } from 'zod';
import { withApiRoute } from '@/lib/api/with-api-route';

const razorpayOrderSchema = z.object({
  plan: z.enum(['starter', 'growth', 'scale'], {
    message: 'Invalid plan. Choose starter, growth, or scale.',
  }),
  interval: z.enum(['month', 'year'], {
    message: 'Invalid interval. Choose month or year.',
  }),
});

/**
 * POST /api/tenant/billing/razorpay
 * Creates a Razorpay order for subscription purchase.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }

    if (!isRazorpayConfigured()) {
      return NextResponse.json(
        { error: 'Razorpay is not configured. Contact support.' },
        { status: 503 },
      );
    }

    const raw = await readJsonBody(request);
    const parsed = validateBody(razorpayOrderSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { plan, interval } = parsed.data;

    const amount = getPlanAmount(plan, interval);
    if (!amount) {
      return NextResponse.json(
        { error: `Pricing not available for ${plan}/${interval}` },
        { status: 400 },
      );
    }

    const receipt = `nucrm_${ctx.tenantId}_${plan}_${Date.now()}`;

    const order = await createOrder(amount, 'INR', receipt, {
      tenant_id: ctx.tenantId,
      plan_id: plan,
      interval,
      user_id: ctx.userId,
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env['RAZORPAY_KEY_ID'],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

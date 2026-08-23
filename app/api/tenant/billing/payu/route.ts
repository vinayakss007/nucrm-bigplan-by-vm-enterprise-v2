/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { isPayUConfigured, createPaymentLink } from '@/lib/payu';
import crypto from 'crypto';

/**
 * POST /api/tenant/billing/payu
 *
 * Generates PayU payment form data for a quote payment.
 * Requires admin role. Returns the PayU form action URL and params
 * that the client uses to submit a POST form redirect to PayU.
 *
 * Body: { quoteId, amount, customerName, customerEmail, customerPhone }
 * Returns: { action, params: { key, txnid, amount, hash, ... } }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }

    const limited = await rateLimitMutating(request, 'quotes', 'post');
    if (limited) return limited;

    if (!isPayUConfigured()) {
      return NextResponse.json({ error: 'PayU is not configured' }, { status: 503 });
    }

    const body = await request.json() as Record<string, unknown>;
    const { quoteId, amount, customerName, customerEmail, customerPhone } = body;

    if (!quoteId || typeof quoteId !== 'string') {
      return NextResponse.json({ error: 'quoteId is required' }, { status: 400 });
    }
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    if (!customerName || typeof customerName !== 'string') {
      return NextResponse.json({ error: 'customerName is required' }, { status: 400 });
    }
    if (!customerEmail || typeof customerEmail !== 'string') {
      return NextResponse.json({ error: 'customerEmail is required' }, { status: 400 });
    }
    if (!customerPhone || typeof customerPhone !== 'string') {
      return NextResponse.json({ error: 'customerPhone is required' }, { status: 400 });
    }

    const txnId = `NUCRM_${quoteId}_${crypto.randomBytes(4).toString('hex')}`;

    const baseUrl = request.headers.get('origin') || request.nextUrl.origin;
    const successUrl = `${baseUrl}/api/webhooks/payu?status=success`;
    const failureUrl = `${baseUrl}/api/webhooks/payu?status=failure`;

    const formData = createPaymentLink({
      amount: amount as number,
      productInfo: `Quote Payment - ${quoteId}`,
      customerName: customerName as string,
      customerEmail: customerEmail as string,
      customerPhone: customerPhone as string,
      txnId,
      successUrl,
      failureUrl,
    });

    return NextResponse.json(formData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

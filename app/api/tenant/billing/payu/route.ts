/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { isPayUConfigured, createPaymentLink } from '@/lib/payu';
import crypto from 'crypto';

// This is an admin-initiated payment-link request (NOT the PayU provider
// callback — that lives at /api/webhooks/payu). The payload is fully
// client-controlled, so a strict schema is appropriate. Fields mirror the
// existing manual checks: all required, amount must be a positive number.
const payuPaymentSchema = z.object({
  quoteId: z.string().min(1),
  amount: z.number().positive(),
  customerName: z.string().min(1),
  customerEmail: z.string().min(1),
  customerPhone: z.string().min(1),
});

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

    const raw = await readJsonBody(request);
    const validated = validateBody(payuPaymentSchema, raw);
    if (validated instanceof NextResponse) return validated;
    const { quoteId, amount, customerName, customerEmail, customerPhone } = validated.data;

    const txnId = `NUCRM_${quoteId}_${crypto.randomBytes(4).toString('hex')}`;

    const baseUrl = request.headers.get('origin') || request.nextUrl.origin;
    const successUrl = `${baseUrl}/api/webhooks/payu?status=success`;
    const failureUrl = `${baseUrl}/api/webhooks/payu?status=failure`;

    const formData = createPaymentLink({
      amount,
      productInfo: `Quote Payment - ${quoteId}`,
      customerName,
      customerEmail,
      customerPhone,
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

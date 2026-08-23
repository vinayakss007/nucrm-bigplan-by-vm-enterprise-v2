/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isPayUConfigured, verifyPayUResponse } from '@/lib/payu';

/**
 * POST /api/webhooks/payu
 *
 * Handles PayU payment callback (success/failure).
 * PayU sends a POST with form data containing transaction details and hash.
 * This endpoint verifies the hash and processes the payment status.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isPayUConfigured()) {
      return NextResponse.json({ error: 'PayU is not configured' }, { status: 503 });
    }

    const formData = await request.formData();

    const key = formData.get('key') as string | null;
    const txnid = formData.get('txnid') as string | null;
    const amount = formData.get('amount') as string | null;
    const productinfo = formData.get('productinfo') as string | null;
    const firstname = formData.get('firstname') as string | null;
    const email = formData.get('email') as string | null;
    const status = formData.get('status') as string | null;
    const hash = formData.get('hash') as string | null;
    const udf1 = (formData.get('udf1') as string) || '';
    const udf2 = (formData.get('udf2') as string) || '';
    const udf3 = (formData.get('udf3') as string) || '';
    const udf4 = (formData.get('udf4') as string) || '';
    const udf5 = (formData.get('udf5') as string) || '';
    const additionalCharges = (formData.get('additionalCharges') as string) || '';

    if (!key || !txnid || !amount || !productinfo || !firstname || !email || !status || !hash) {
      return NextResponse.json({ error: 'Missing required payment parameters' }, { status: 400 });
    }

    const isValid = verifyPayUResponse({
      key,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      status,
      hash,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      ...(additionalCharges ? { additionalCharges } : {}),
    });

    if (!isValid) {
      console.error(`[PayU Webhook] Hash verification failed for txnid: ${txnid}`);
      return NextResponse.json({ error: 'Hash verification failed' }, { status: 400 });
    }

    // Extract quoteId from txnid format: NUCRM_{quoteId}_{random}
    const txnParts = txnid.split('_');
    const quoteId = txnParts.length >= 3 ? txnParts.slice(1, -1).join('_') : txnid;

    if (status === 'success') {
      console.log(`[PayU Webhook] Payment successful for quote: ${quoteId}, txnid: ${txnid}, amount: ${amount}`);
      // TODO: Update quote/invoice payment status in database
      // TODO: Fire internal webhook event for payment received
    } else {
      console.log(`[PayU Webhook] Payment failed for quote: ${quoteId}, txnid: ${txnid}, status: ${status}`);
      // TODO: Update quote/invoice with failure status
    }

    // Return success to PayU (acknowledge receipt)
    return NextResponse.json({
      received: true,
      txnid,
      status,
      quoteId,
    });
  } catch (err: unknown) {
    console.error('[PayU Webhook] Error processing callback:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

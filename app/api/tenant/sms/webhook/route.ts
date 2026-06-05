import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateTwilioSignature, handleIncomingSMS, updateDeliveryStatus } from '@/lib/sms';
import type { IncomingSMSPayload, DeliveryStatusPayload } from '@/lib/sms';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

/**
 * Twilio SMS Webhook Handler
 *
 * Public endpoint (no auth required). Validates via Twilio signature.
 * Handles both incoming SMS and delivery status callbacks.
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit public endpoint
    const rateLimited = checkPublicRateLimit(req, { max: 100, windowMs: 60_000, prefix: 'sms-webhook' });
    if (rateLimited) return rateLimited;
    const contentType = req.headers.get('content-type') || '';
    let params: Record<string, string> = {};

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const urlParams = new URLSearchParams(text);
      urlParams.forEach((value, key) => {
        params[key] = value;
      });
    } else {
      params = await req.json();
    }

    // Validate Twilio signature in production
    if (process.env['NODE_ENV'] === 'production') {
      const signature = req.headers.get('x-twilio-signature') || '';
      const url = req.url;
      if (!validateTwilioSignature(signature, url, params)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
    }

    // Determine tenant from the 'To' number or custom parameter
    const tenantId = params['TenantId'] || process.env['DEFAULT_TENANT_ID'] || '';

    // Handle delivery status updates
    if (params['MessageStatus'] && params['MessageSid']) {
      const payload: DeliveryStatusPayload = {
        MessageSid: params['MessageSid'],
        MessageStatus: params['MessageStatus'],
        ErrorCode: params['ErrorCode'],
        ErrorMessage: params['ErrorMessage'],
      };
      const result = await updateDeliveryStatus(payload);
      return NextResponse.json(result);
    }

    // Handle incoming SMS
    if (params['From'] && params['Body']) {
      const payload: IncomingSMSPayload = {
        From: params['From'],
        To: params['To'] || '',
        Body: params['Body'],
        MessageSid: params['MessageSid'] || '',
        AccountSid: params['AccountSid'],
        NumMedia: params['NumMedia'],
      };
      const result = await handleIncomingSMS(payload, tenantId);
      // Return TwiML empty response
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    return NextResponse.json({ error: 'Unrecognized webhook payload' }, { status: 400 });
  } catch (err) {
    return apiError(err);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { handleSigningWebhook, getProviderAdapter } from '@/lib/esignature';
import type { SigningProvider, SigningEventType } from '@/lib/esignature';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

/**
 * POST /api/tenant/esignature/webhook
 * Handle provider webhooks (DocuSign, HelloSign).
 * No auth required - validated by provider-specific means.
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit public endpoint
    const rateLimited = checkPublicRateLimit(req, { max: 100, windowMs: 60_000, prefix: 'esign-webhook' });
    if (rateLimited) return rateLimited;
    const body = await req.json();
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider') as SigningProvider | null;

    if (!provider || !['docusign', 'hellosign', 'internal'].includes(provider)) {
      return NextResponse.json(
        { error: 'Valid provider query parameter is required' },
        { status: 400 }
      );
    }

    // Validate webhook using provider-specific validation
    const adapter = getProviderAdapter(provider);
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const isValid = adapter.validateWebhook(body, headers);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      );
    }

    // Parse webhook event based on provider
    let externalId: string;
    let event: SigningEventType;
    let signerEmail: string | undefined;

    if (provider === 'docusign') {
      externalId = body.envelopeId || body.data?.envelopeId || '';
      event = mapDocuSignEvent(body.event || body.status || '');
      signerEmail = body.recipientEmail || body.data?.recipientEmail;
    } else if (provider === 'hellosign') {
      externalId = body.signature_request?.signature_request_id || '';
      event = mapHelloSignEvent(body.event?.event_type || '');
      signerEmail = body.event?.event_metadata?.related_signature?.signer_email_address;
    } else {
      externalId = body.externalId || '';
      event = body.event || 'viewed';
      signerEmail = body.signerEmail;
    }

    if (!externalId) {
      return NextResponse.json(
        { error: 'Could not extract request identifier from webhook payload' },
        { status: 400 }
      );
    }

    const result = await handleSigningWebhook({
      provider,
      externalId,
      event,
      signerEmail,
      metadata: body,
    });

    return NextResponse.json({
      data: { processed: result.updated },
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[esignature-webhook] Error:', err);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

function mapDocuSignEvent(event: string): SigningEventType {
  const map: Record<string, SigningEventType> = {
    'envelope-sent': 'sent',
    'envelope-delivered': 'viewed',
    'envelope-completed': 'signed',
    'recipient-sent': 'sent',
    'recipient-delivered': 'viewed',
    'recipient-completed': 'signed',
    'recipient-declined': 'declined',
  };
  return map[event] || 'viewed';
}

function mapHelloSignEvent(eventType: string): SigningEventType {
  const map: Record<string, SigningEventType> = {
    'signature_request_sent': 'sent',
    'signature_request_viewed': 'viewed',
    'signature_request_signed': 'signed',
    'signature_request_declined': 'declined',
  };
  return map[eventType] || 'viewed';
}

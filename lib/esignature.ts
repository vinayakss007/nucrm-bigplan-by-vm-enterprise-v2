/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * E-Signature Integration
 *
 * Adapter pattern supporting DocuSign, HelloSign, and internal signing.
 * Provides request creation, status tracking, and webhook handling.
 */

import { db } from '@/drizzle/db';
import { signingRequests, signingEvents } from '@/drizzle/schema/esignature';
import { eq, and } from 'drizzle-orm';
import { createHmac, randomBytes } from 'crypto';

// ── Types ─────────────────────────────────────────────

export type SigningProvider = 'docusign' | 'hellosign' | 'internal';

export type SigningStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';

export type SigningEventType = 'sent' | 'viewed' | 'signed' | 'declined';

export interface Signer {
  email: string;
  name: string;
  order?: number;
  role?: string;
  /**
   * Per-signer opaque token for the built-in (internal) signing flow. It is the
   * credential for the public signer page at /p/sign/[token]. Only set for the
   * `internal` provider; external providers host their own signer UI. (#1613)
   */
  token?: string;
  /** Per-signer terminal state for the internal flow. */
  signedAt?: string | null;
  declinedAt?: string | null;
}

export interface SigningRequest {
  id: string;
  tenantId: string;
  documentId: string;
  provider: SigningProvider;
  status: SigningStatus;
  externalId?: string | null;
  signers: Signer[];
  metadata?: Record<string, unknown>;
}

export interface CreateSigningRequestInput {
  documentId: string;
  signers: Signer[];
  provider: SigningProvider;
  tenantId: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookPayload {
  provider: SigningProvider;
  externalId: string;
  event: SigningEventType;
  signerEmail?: string;
  metadata?: Record<string, unknown>;
}

// ── Provider Adapter Interface ────────────────────────

export interface SigningProviderAdapter {
  createRequest(input: CreateSigningRequestInput): Promise<{ externalId: string }>;
  getStatus(externalId: string): Promise<SigningStatus>;
  validateWebhook(payload: unknown, headers: Record<string, string>): boolean;
}

// ── DocuSign Adapter ──────────────────────────────────

export class DocuSignAdapter implements SigningProviderAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env['DOCUSIGN_API_KEY'] || '';
    this.baseUrl = process.env['DOCUSIGN_BASE_URL'] || 'https://demo.docusign.net/restapi';
  }

  async createRequest(input: CreateSigningRequestInput): Promise<{ externalId: string }> {
    // In production, this would call DocuSign's envelope API
    const response = await fetch(`${this.baseUrl}/v2.1/accounts/me/envelopes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documents: [{ documentId: input.documentId }],
        recipients: {
          signers: input.signers.map((s, i) => ({
            email: s.email,
            name: s.name,
            recipientId: String(i + 1),
            routingOrder: String(s.order || i + 1),
          })),
        },
        status: 'sent',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`DocuSign API error: ${response.status}`);
    }

    const data = await response.json();
    return { externalId: data.envelopeId };
  }

  async getStatus(externalId: string): Promise<SigningStatus> {
    const response = await fetch(`${this.baseUrl}/v2.1/accounts/me/envelopes/${externalId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`DocuSign API error: ${response.status}`);
    }

    const data = await response.json();
    return mapDocuSignStatus(data.status);
  }

  validateWebhook(payload: unknown, headers: Record<string, string>): boolean {
    // DocuSign uses HMAC-SHA256 signature in x-docusign-signature-1 header
    const signature = headers['x-docusign-signature-1'];
    if (!signature) return false;

    const webhookSecret = process.env['DOCUSIGN_WEBHOOK_SECRET'];
    if (!webhookSecret) {
      // Fail CLOSED: without a secret there is nothing to verify against,
      // so any signature must be rejected (a presence check proves nothing).
      return false;
    }

    // Compute HMAC-SHA256 and compare
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const computed = createHmac('sha256', webhookSecret)
      .update(payloadString)
      .digest('base64');

    return computed === signature;
  }
}

// ── HelloSign Adapter ─────────────────────────────────

export class HelloSignAdapter implements SigningProviderAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env['HELLOSIGN_API_KEY'] || '';
    this.baseUrl = process.env['HELLOSIGN_BASE_URL'] || 'https://api.hellosign.com/v3';
  }

  async createRequest(input: CreateSigningRequestInput): Promise<{ externalId: string }> {
    const response = await fetch(`${this.baseUrl}/signature_request/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `Document ${input.documentId}`,
        signers: input.signers.map((s, i) => ({
          email_address: s.email,
          name: s.name,
          order: s.order || i,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HelloSign API error: ${response.status}`);
    }

    const data = await response.json();
    return { externalId: data.signature_request?.signature_request_id };
  }

  async getStatus(externalId: string): Promise<SigningStatus> {
    const response = await fetch(`${this.baseUrl}/signature_request/${externalId}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HelloSign API error: ${response.status}`);
    }

    const data = await response.json();
    return mapHelloSignStatus(data.signature_request?.status_code);
  }

  validateWebhook(payload: unknown, headers: Record<string, string>): boolean {
    // HelloSign uses event hash validation
    const eventHash = headers['x-hellosign-event-hash'];
    if (!eventHash) return false;

    const webhookSecret = process.env['HELLOSIGN_WEBHOOK_SECRET'];
    if (!webhookSecret) {
      // Fail CLOSED (see DocuSign adapter above).
      return false;
    }

    // Compute HMAC-SHA256 and compare
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const computed = createHmac('sha256', webhookSecret)
      .update(payloadString)
      .digest('hex');

    return computed === eventHash;
  }
}

// ── Internal Adapter (built-in, no external service) ──
//
// The built-in provider needs no third-party API. A signing request is created
// locally, each signer gets an opaque token (their link to /p/sign/[token]),
// and status is derived from the recorded `signing_events` in our own DB.
// There is no inbound provider webhook for the internal flow — the public
// signer route (POST /api/public/sign/[token]) records events directly — so
// validateWebhook() rejects rather than blindly trusting an unsigned payload.

export class InternalAdapter implements SigningProviderAdapter {
  async createRequest(_input: CreateSigningRequestInput): Promise<{ externalId: string }> {
    // Opaque, unguessable id used to correlate the request; per-signer tokens
    // (the actual signing credentials) are minted in createSigningRequest().
    return { externalId: `internal-${randomBytes(16).toString('hex')}` };
  }

  async getStatus(externalId: string): Promise<SigningStatus> {
    // Derive status from our own persisted request rather than returning a
    // hard-coded 'pending'. Falls back to 'pending' only when unknown.
    const row = await db.query.signingRequests.findFirst({
      where: and(
        eq(signingRequests.externalId, externalId),
        eq(signingRequests.provider, 'internal'),
      ),
    });
    return (row?.status as SigningStatus) ?? 'pending';
  }

  validateWebhook(_payload: unknown, _headers: Record<string, string>): boolean {
    // The internal provider has no external webhook. Any webhook claiming to be
    // `internal` is illegitimate — reject it. Internal signer actions go through
    // the authenticated-by-token public signer route instead.
    return false;
  }
}

/** Generate an unguessable per-signer signing token. */
function generateSignerToken(): string {
  return randomBytes(32).toString('base64url');
}

// ── Provider Factory ──────────────────────────────────

export function getProviderAdapter(provider: SigningProvider): SigningProviderAdapter {
  switch (provider) {
    case 'docusign':
      return new DocuSignAdapter();
    case 'hellosign':
      return new HelloSignAdapter();
    case 'internal':
      return new InternalAdapter();
    default:
      throw new Error(`Unsupported signing provider: ${provider}`);
  }
}

// ── Core Functions ────────────────────────────────────

/**
 * Create a signing request with the specified provider
 */
export async function createSigningRequest(input: CreateSigningRequestInput): Promise<SigningRequest> {
  const adapter = getProviderAdapter(input.provider);

  // Create request with provider
  const { externalId } = await adapter.createRequest(input);

  // For the built-in provider, mint a per-signer token so each recipient has a
  // real link to the public signer page. External providers host signing
  // themselves, so no token is stored. (#1613)
  const signers: Signer[] = input.provider === 'internal'
    ? input.signers.map((s) => ({ ...s, token: generateSignerToken(), signedAt: null, declinedAt: null }))
    : input.signers;

  // Store in database (both tables in a single transaction)
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.insert(signingRequests).values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      provider: input.provider,
      status: 'sent',
      externalId,
      signers,
      metadata: input.metadata || {},
    }).returning();

    if (!row) throw new Error('Failed to create signing request');

    // Record the sent event for each signer
    if (signers.length > 0) {
      const eventValues = signers.map(signer => ({
        requestId: row.id,
        tenantId: input.tenantId,
        signerEmail: signer.email,
        event: 'sent' as const,
        metadata: {},
      }));
      await tx.insert(signingEvents).values(eventValues);
    }

    return row;
  });

  return {
    id: result.id,
    tenantId: result.tenantId,
    documentId: result.documentId,
    provider: result.provider as SigningProvider,
    status: result.status as SigningStatus,
    externalId: result.externalId,
    signers,
    metadata: (result.metadata as Record<string, unknown>) || {},
  };
}

// ── Built-in (internal) signer flow ───────────────────
// Lives in lib/esignature-internal.ts (#2380); re-exported so the
// public signer route and the tenant esignature routes keep their imports.
export {
  getInternalSigningByToken,
  recordInternalSignerEvent,
  listSigningEvents,
} from "./esignature-internal";
export type { InternalSignerView } from "./esignature-internal";


/**
 * Get signing request status
 */
export async function getSigningStatus(requestId: string, tenantId: string): Promise<SigningRequest | null> {
  const row = await db.query.signingRequests.findFirst({
    where: and(
      eq(signingRequests.id, requestId),
      eq(signingRequests.tenantId, tenantId)
    ),
  });

  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    documentId: row.documentId,
    provider: row.provider as SigningProvider,
    status: row.status as SigningStatus,
    externalId: row.externalId,
    signers: (row.signers as Signer[]) || [],
    metadata: (row.metadata as Record<string, unknown>) || {},
  };
}

/**
 * Handle signing webhook from provider
 */
export async function handleSigningWebhook(payload: WebhookPayload): Promise<{ updated: boolean }> {
  // Find the signing request by externalId and provider
  const row = await db.query.signingRequests.findFirst({
    where: and(
      eq(signingRequests.externalId, payload.externalId),
      eq(signingRequests.provider, payload.provider)
    ),
  });

  if (!row) {
    return { updated: false };
  }

  // Map event to status
  const newStatus = mapEventToStatus(payload.event);

  // Update request status + record event in a single transaction
  await db.transaction(async (tx) => {
    await tx.update(signingRequests)
      .set({ status: newStatus })
      .where(eq(signingRequests.id, row.id));

    await tx.insert(signingEvents).values({
      requestId: row.id,
      tenantId: row.tenantId,
      signerEmail: payload.signerEmail || 'unknown',
      event: payload.event,
      metadata: payload.metadata || {},
    });
  });

  return { updated: true };
}

// ── Status Mapping Helpers ────────────────────────────

function mapDocuSignStatus(status: string): SigningStatus {
  const map: Record<string, SigningStatus> = {
    'sent': 'sent',
    'delivered': 'viewed',
    'completed': 'signed',
    'declined': 'declined',
    'voided': 'expired',
  };
  return map[status] || 'pending';
}

function mapHelloSignStatus(statusCode: string): SigningStatus {
  const map: Record<string, SigningStatus> = {
    'awaiting_signature': 'sent',
    'signed': 'signed',
    'declined': 'declined',
    'expired': 'expired',
  };
  return map[statusCode] || 'pending';
}

function mapEventToStatus(event: SigningEventType): SigningStatus {
  const map: Record<SigningEventType, SigningStatus> = {
    'sent': 'sent',
    'viewed': 'viewed',
    'signed': 'signed',
    'declined': 'declined',
  };
  return map[event] || 'pending';
}

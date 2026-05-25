/**
 * E-Signature Integration
 *
 * Adapter pattern supporting DocuSign, HelloSign, and internal signing.
 * Provides request creation, status tracking, and webhook handling.
 */

import { db } from '@/drizzle/db';
import { signingRequests, signingEvents } from '@/drizzle/schema/esignature';
import { eq, and } from 'drizzle-orm';

// ── Types ─────────────────────────────────────────────

export type SigningProvider = 'docusign' | 'hellosign' | 'internal';

export type SigningStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';

export type SigningEventType = 'sent' | 'viewed' | 'signed' | 'declined';

export interface Signer {
  email: string;
  name: string;
  order?: number;
  role?: string;
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
    });

    if (!response.ok) {
      throw new Error(`DocuSign API error: ${response.status}`);
    }

    const data = await response.json();
    return mapDocuSignStatus(data.status);
  }

  validateWebhook(_payload: unknown, headers: Record<string, string>): boolean {
    // DocuSign uses HMAC-SHA256 signature in x-docusign-signature-1 header
    const signature = headers['x-docusign-signature-1'];
    return !!signature;
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
    });

    if (!response.ok) {
      throw new Error(`HelloSign API error: ${response.status}`);
    }

    const data = await response.json();
    return mapHelloSignStatus(data.signature_request?.status_code);
  }

  validateWebhook(_payload: unknown, headers: Record<string, string>): boolean {
    // HelloSign uses event hash validation
    const eventHash = headers['x-hellosign-event-hash'];
    return !!eventHash;
  }
}

// ── Internal Adapter (no external service) ────────────

export class InternalAdapter implements SigningProviderAdapter {
  async createRequest(_input: CreateSigningRequestInput): Promise<{ externalId: string }> {
    return { externalId: `internal-${Date.now()}` };
  }

  async getStatus(_externalId: string): Promise<SigningStatus> {
    return 'pending';
  }

  validateWebhook(_payload: unknown, _headers: Record<string, string>): boolean {
    return true;
  }
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

  // Store in database
  const [row] = await db.insert(signingRequests).values({
    tenantId: input.tenantId,
    documentId: input.documentId,
    provider: input.provider,
    status: 'sent',
    externalId,
    signers: input.signers,
    metadata: input.metadata || {},
  }).returning();

  // Record the sent event for each signer
  for (const signer of input.signers) {
    await db.insert(signingEvents).values({
      requestId: row!.id,
      tenantId: input.tenantId,
      signerEmail: signer.email,
      event: 'sent',
      metadata: {},
    });
  }

  return {
    id: row!.id,
    tenantId: row!.tenantId,
    documentId: row!.documentId,
    provider: row!.provider as SigningProvider,
    status: row!.status as SigningStatus,
    externalId: row!.externalId,
    signers: input.signers,
    metadata: (row!.metadata as Record<string, unknown>) || {},
  };
}

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

  // Update request status
  await db.update(signingRequests)
    .set({ status: newStatus })
    .where(eq(signingRequests.id, row.id));

  // Record event
  await db.insert(signingEvents).values({
    requestId: row.id,
    tenantId: row.tenantId,
    signerEmail: payload.signerEmail || 'unknown',
    event: payload.event,
    metadata: payload.metadata || {},
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

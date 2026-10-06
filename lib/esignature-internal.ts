/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Built-in (internal) e-signature signer flow (#1613).
 *
 * These functions power the public signer page at /p/sign/[token]: the token
 * IS the credential, there is no auth session. Split out of lib/esignature.ts
 * under the file-size ratchet (#1843/#422) and re-exported there, so every
 * existing import path keeps working.
 */
import { db } from '@/drizzle/db';
import { signingRequests, signingEvents } from '@/drizzle/schema/esignature';
import { documents } from '@/drizzle/schema/documents';
import { eq, and, asc, isNull } from 'drizzle-orm';
import type { Signer, SigningRequest, SigningStatus, SigningEventType } from './esignature';

// ── Built-in (internal) signer flow ───────────────────
// These power the public signer page at /p/sign/[token]. The token is the
// credential; no auth session is required. All lookups are constant-time-ish
// (indexed request scan + token compare) and never leak tenant data.

export interface InternalSignerView {
  request: SigningRequest;
  signer: Signer;
  documentId: string;
  status: SigningStatus;
  alreadyResolved: boolean; // signer already signed or declined
}

/**
 * Resolve a signing request + the specific signer by their opaque token.
 * Returns null when the token matches no internal signer.
 */
export async function getInternalSigningByToken(token: string): Promise<InternalSignerView | null> {
  if (!token) return null;

  // Scan internal requests and match the signer token in JSONB. Volume is low
  // (open signing requests per instance), and provider is indexed.
  const rows = await db.query.signingRequests.findMany({
    where: eq(signingRequests.provider, 'internal'),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
    limit: 500,
  });

  for (const row of rows) {
    const signers = (row.signers as Signer[]) || [];
    const signer = signers.find((s) => s.token === token);
    if (!signer) continue;

    // #2380: withdrawing a document must kill its signing link. The tenant
    // DELETE handler only stamps documents.deleted_at, and RLS scopes by
    // tenant_id alone — so without this filter an unauthenticated signer can
    // still open the page and POST `sign`, which writes signing_events and
    // rolls the request up to `signed` against a deleted document. Hard
    // deletes cannot orphan us here: document_id is NOT NULL ON DELETE
    // CASCADE, so a request outlives its document only via soft delete.
    const [liveDocument] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, row.documentId), isNull(documents.deletedAt)))
      .limit(1);
    if (!liveDocument) return null;

    const request: SigningRequest = {
      id: row.id,
      tenantId: row.tenantId,
      documentId: row.documentId,
      provider: 'internal',
      status: row.status as SigningStatus,
      externalId: row.externalId,
      signers,
      metadata: (row.metadata as Record<string, unknown>) || {},
    };
    return {
      request,
      signer,
      documentId: row.documentId,
      status: row.status as SigningStatus,
      alreadyResolved: Boolean(signer.signedAt || signer.declinedAt),
    };
  }
  return null;
}

/**
 * Record a signer action (viewed | signed | declined) for the built-in flow.
 * - Writes a real row into `signing_events`.
 * - Stamps the per-signer signedAt/declinedAt in the signers JSONB.
 * - Rolls the request status up: signed once ALL signers have signed;
 *   declined as soon as ANY signer declines; viewed on first open.
 *
 * Idempotent for terminal states: a signer who already signed/declined cannot
 * change the outcome.
 */
export async function recordInternalSignerEvent(
  token: string,
  event: SigningEventType,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ ok: boolean; status?: SigningStatus; reason?: string }> {
  const view = await getInternalSigningByToken(token);
  if (!view) return { ok: false, reason: 'not_found' };

  const { request, signer } = view;

  if ((event === 'signed' || event === 'declined') && (signer.signedAt || signer.declinedAt)) {
    return { ok: false, reason: 'already_resolved', status: request.status };
  }

  const now = new Date().toISOString();
  const updatedSigners: Signer[] = request.signers.map((s) => {
    if (s.token !== token) return s;
    if (event === 'signed') return { ...s, signedAt: now };
    if (event === 'declined') return { ...s, declinedAt: now };
    return s;
  });

  // Compute the rolled-up request status.
  let newStatus: SigningStatus = request.status;
  if (event === 'declined') {
    newStatus = 'declined';
  } else if (event === 'signed') {
    const allSigned = updatedSigners.every((s) => Boolean(s.signedAt));
    newStatus = allSigned ? 'signed' : request.status === 'declined' ? 'declined' : 'sent';
  } else if (event === 'viewed' && request.status === 'sent') {
    newStatus = 'viewed';
  }

  await db.transaction(async (tx) => {
    await tx.update(signingRequests)
      .set({ status: newStatus, signers: updatedSigners })
      .where(eq(signingRequests.id, request.id));

    await tx.insert(signingEvents).values({
      requestId: request.id,
      tenantId: request.tenantId,
      signerEmail: signer.email,
      event,
      metadata: { ip: meta?.ip, userAgent: meta?.userAgent },
    });
  });

  return { ok: true, status: newStatus };
}

/**
 * Public-safe list of signing events for a request (for the signer page audit
 * trail). Emails are returned as-is because the signer already knows the
 * participants of their own request.
 */
export async function listSigningEvents(requestId: string): Promise<
  Array<{ event: string; signerEmail: string; eventAt: string }>
> {
  const rows = await db.select({
    event: signingEvents.event,
    signerEmail: signingEvents.signerEmail,
    eventAt: signingEvents.eventAt,
  })
    .from(signingEvents)
    .where(eq(signingEvents.requestId, requestId))
    .orderBy(asc(signingEvents.eventAt));
  return rows.map((r) => ({
    event: r.event,
    signerEmail: r.signerEmail,
    eventAt: (r.eventAt instanceof Date ? r.eventAt : new Date(r.eventAt)).toISOString(),
  }));
}

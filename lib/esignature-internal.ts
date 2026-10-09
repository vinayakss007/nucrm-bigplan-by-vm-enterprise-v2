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
import { eq, and, asc, sql, isNull } from 'drizzle-orm';
import { setTenantContext, withTenantContext, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';
import { setPortalLookupContext } from '@/lib/db/portal-lookup-context';
import type { Signer, SigningRequest, SigningStatus, SigningEventType } from './esignature';

// ── Built-in (internal) signer flow ───────────────────
// These power the public signer page at /p/sign/[token]. The token is the
// credential; no auth session is required. All lookups are constant-time-ish
// (indexed request scan + token compare) and never leak tenant data.

export interface InternalSignerView {
  request: SigningRequest;
  signer: Signer;
  documentId: string;
  /** Name of the live document the gate below admitted (#2468: read with the
   *  request so the page does not issue a second, context-less `documents` read). */
  documentName: string;
  status: SigningStatus;
  alreadyResolved: boolean; // signer already signed or declined
}

/**
 * Resolve a signing request + the specific signer by their opaque token.
 * Returns null when the token matches no internal signer.
 *
 * #2468 — WHY ONE TRANSACTION SETS TWO CONTEXTS. The row that says which
 * workspace a signing link belongs to is the row the link is authenticated by,
 * so the read cannot be tenant-scoped: `signing_requests`' only other policy
 * compares `tenant_id` to `app.current_tenant`, a value this request does not
 * have yet, which under 0039's fail-closed deparse was a silent zero-row read —
 * every signing link 404'd for the role the app actually runs as. Migration
 * 0123's `signing_requests_signer_credential_lookup` arm admits exactly the row
 * whose `signers` array carries the credential, and it is reached by naming that
 * credential in `app.portal_lookup_token` (`withPortalLookupContext`'s GUC, reused
 * rather than added: `lib/db/pool.ts` and `lib/db/request-connection.ts` already
 * reset that name on checkout, so nothing can leak it to another request).
 * Everything AFTER the row is known runs in the workspace the row names, in the
 * same transaction — one connection checkout and one credential read for a page
 * that used to need three reads and no context at all (PP-028 measured each
 * stray `set_config` round trip at ~200 ms under PgBouncer transaction pooling).
 */
export async function getInternalSigningByToken(token: string): Promise<InternalSignerView | null> {
  if (!token) return null;

  return db.transaction(async (tx) => {
    await setPortalLookupContext({ accessToken: token }, tx);

    // The containment test is the policy's own expression, so the SQL matches the
    // rows RLS will admit instead of scanning 500 requests in JS and hoping the
    // token was in the page that came back. Newest-first is the order the previous
    // scan used, so a token that somehow appears twice resolves identically.
    const row = await tx.query.signingRequests.findFirst({
      where: and(
        eq(signingRequests.provider, 'internal'),
        sql`${signingRequests.signers} @> jsonb_build_array(jsonb_build_object('token', ${token}::text))`,
      ),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
    if (!row) return null;

    // #2468: which signer of that request is holding this link is answered from the
    // row already in hand, before any further read. The SQL above is what admits
    // the row at all; this find is defence in depth that also picks the signer out
    // of a multi-signer document — and it keeps #2380's property that a token
    // matching no signer costs no `documents` read.
    const signers = (row.signers as Signer[]) || [];
    const signer = signers.find((s) => s.token === token);
    if (!signer) return null;

    await setTenantContext(row.tenantId, NO_USER_SENTINEL, tx);

    // #2380: withdrawing a document must kill its signing link. The tenant
    // DELETE handler only stamps documents.deleted_at, and RLS scopes by
    // tenant_id alone — so without this filter an unauthenticated signer can
    // still open the page and POST `sign`, which writes signing_events and
    // rolls the request up to `signed` against a deleted document. Hard
    // deletes cannot orphan us here: document_id is NOT NULL ON DELETE
    // CASCADE, so a request outlives its document only via soft delete.
    const [liveDocument] = await tx
      .select({ id: documents.id, name: documents.name })
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
      documentName: liveDocument.name,
      status: row.status as SigningStatus,
      alreadyResolved: Boolean(signer.signedAt || signer.declinedAt),
    };
  });
}

/**
 * Record a signer action against an already-resolved view, through `tx` — which
 * the caller must have opened in the request's own workspace. Split out so the
 * public GET can fold its first-open `viewed` write into the same transaction as
 * the reads that follow it (#2468), instead of stacking a third context on one
 * page load.
 *
 * - Writes a real row into `signing_events`.
 * - Stamps the per-signer signedAt/declinedAt in the signers JSONB.
 * - Rolls the request status up: signed once ALL signers have signed;
 *   declined as soon as ANY signer declines; viewed on first open.
 */
export async function writeInternalSignerEvent(
  tx: RlsTransaction,
  view: InternalSignerView,
  event: SigningEventType,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ ok: boolean; status?: SigningStatus; reason?: string }> {
  const { request, signer } = view;

  if ((event === 'signed' || event === 'declined') && (signer.signedAt || signer.declinedAt)) {
    return { ok: false, reason: 'already_resolved', status: request.status };
  }

  const now = new Date().toISOString();
  const updatedSigners: Signer[] = request.signers.map((s) => {
    if (s.token !== view.signer.token) return s;
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

  return { ok: true, status: newStatus };
}

/**
 * Record a signer action (viewed | signed | declined) for the built-in flow.
 *
 * Idempotent for terminal states: a signer who already signed/declined cannot
 * change the outcome.
 *
 * #2468: these two writes (`signing_requests`, `signing_events`) are both
 * tenant-policyed and this runs from an unauthenticated route, so the bare
 * `db.transaction()` that used to hold them carried no GUCs — the UPDATE matched
 * nothing and the INSERT was refused. The status rollup and the event row still
 * commit together, now inside the workspace the credential resolved.
 */
export async function recordInternalSignerEvent(
  token: string,
  event: SigningEventType,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ ok: boolean; status?: SigningStatus; reason?: string }> {
  const view = await getInternalSigningByToken(token);
  if (!view) return { ok: false, reason: 'not_found' };

  return withTenantContext(view.request.tenantId, NO_USER_SENTINEL, (tx) =>
    writeInternalSignerEvent(tx, view, event, meta));
}

/**
 * Public-safe list of signing events for a request (for the signer page audit
 * trail). Emails are returned as-is because the signer already knows the
 * participants of their own request.
 *
 * Takes the caller's context-bound handle rather than opening one: the signing
 * page reads this alongside the branding row, in the transaction the credential
 * resolved (#2468).
 */
export async function listSigningEvents(
  tx: RlsTransaction,
  requestId: string,
): Promise<Array<{ event: string; signerEmail: string; eventAt: string }>> {
  const rows = await tx.select({
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

import { getAppUrl } from './app-url';
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Offers helpers
 *
 * Phase 4 of WORKFLOW_PLAN.md. The "offer" concept is a customer-facing wrapper
 * over the existing `quotes` schema:
 *
 *   draft   → the rep is still composing
 *   sent    → public_token issued, buyer can view at /p/offers/<token>
 *   viewed  → set on first GET of the public route (analytics only)
 *   accepted / declined / expired / cancelled → terminal
 *
 * No new table — public_token + offer-lifecycle metadata go in `quotes.metadata.offer`.
 */
import { randomBytes } from 'crypto';
import { db, type DbClient } from '@/drizzle/db';
import { quotes } from '@/drizzle/schema';
import { eq, and, sql, isNull, inArray } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';

export type OfferStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export interface OfferMetadata {
  public_token?: string;
  sent_to_email?: string;
  viewed_at?: string;
  viewed_count?: number;
  accepted_by_email?: string;
  accepted_at?: string;
  decline_reason?: string;
  declined_at?: string;
  expires_at?: string;
}

/** Generate a URL-safe public token. 24 random bytes → 32-char base64url. */
export function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Build the public URL the buyer clicks. */
export function publicOfferUrl(publicToken: string): string {
  const base = getAppUrl();
  return `${base.replace(/\/$/, '')}/p/offers/${publicToken}`;
}

/**
 * Look up a quote by its public token (offer access path).
 * Returns null if no live offer matches — collapses every "no" path so that
 * buyer-facing routes always 404 cleanly without leaking which case hit.
 *
 * #2468: this read is what a buyer's link is authenticated by, and the offer has
 * no workspace to name before it resolves — the same chicken-and-egg #2446
 * documented for `portal_clients`. `quotes`' only other policy compares
 * `tenant_id` to `app.current_tenant`, so on the bare pool this was a silent
 * zero-row read and every offer link answered 404. It now runs inside
 * `withPortalLookupContext()`, which is what names migration 0123's
 * `quotes_offer_credential_lookup` arm. The context is SELECT-only and knows no
 * tenant, so everything after this lookup still needs `withTenantContext()` from
 * the caller, keyed on the row's own `tenantId`.
 *
 * The shape check is the same reasoning as `SURVEY_TOKEN_RE` in the CSAT route:
 * `generatePublicToken()` is base64url, so anything outside that alphabet — and
 * anything long enough to trip `requireLookupValue`'s 512-character cap — is not
 * a link that ever existed. Refusing it here returns the 404 every other "no"
 * path on this surface returns, instead of throwing through the lookup context
 * into a 500 that Sentry pages an operator for.
 */
const OFFER_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export async function findOfferByToken(publicToken: string) {
  if (!publicToken || !OFFER_TOKEN_RE.test(publicToken)) return null;

  const row = await withPortalLookupContext({ accessToken: publicToken }, (tx) =>
    tx.query.quotes.findFirst({
      where: and(
        sql`(${quotes.metadata}->'offer'->>'public_token') = ${publicToken}`,
        isNull(quotes.deletedAt),
      ),
    }),
  );
  return row ?? null;
}

/**
 * Patch the `metadata.offer` jsonb sub-tree without clobbering siblings.
 *
 * Accepts an optional dbOrTx (mirrors lib/audit.ts logAudit) so callers can
 * thread a transaction and keep the status update + metadata patch atomic.
 * Defaults to the shared db when omitted — no behavior change for existing
 * no-tx callers, and the jsonb_set SQL is unchanged.
 */
export async function patchOfferMetadata(quoteId: string, tenantId: string, patch: Partial<OfferMetadata>, dbOrTx?: DbClient): Promise<void> {
  const client = dbOrTx ?? db;
  await client
    .update(quotes)
    .set({
      metadata: sql`
        jsonb_set(
          COALESCE(${quotes.metadata}, '{}'::jsonb),
          '{offer}',
          COALESCE(${quotes.metadata}->'offer', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
        )
      `,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, quoteId), eq(quotes.tenantId, tenantId)));
}

/**
 * Atomically increment `metadata.offer.viewed_count` in ONE statement (#2344).
 *
 * patchOfferMetadata merges server-side but the CALLER computed the new value
 * from a stale read — concurrent offer views lost increments. Here Postgres
 * reads and writes the same value inside jsonb_set, so nothing is lost. Only
 * the viewed_count key changes; sibling keys keep the same merge semantics
 * patchOfferMetadata gives them. A non-numeric legacy value counts as 0
 * (guarded by the regex CASE, never a cast error).
 *
 * Takes an optional dbOrTx like patchOfferMetadata so callers can fold it
 * into the same transaction as the status write.
 */
export async function incrementOfferViewedCount(quoteId: string, tenantId: string, dbOrTx?: DbClient): Promise<void> {
  const client = dbOrTx ?? db;
  await client
    .update(quotes)
    .set({
      metadata: sql`
        jsonb_set(
          COALESCE(${quotes.metadata}, '{}'::jsonb),
          '{offer}',
          jsonb_set(
            COALESCE(${quotes.metadata}->'offer', '{}'::jsonb),
            '{viewed_count}',
            to_jsonb(
              CASE WHEN (${quotes.metadata}->'offer'->>'viewed_count') ~ '^[0-9]+$'
                   THEN CAST(${quotes.metadata}->'offer'->>'viewed_count' AS integer)
                   ELSE 0 END
              + 1
            )
          )
        )
      `,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, quoteId), eq(quotes.tenantId, tenantId)));
}

/** Given a quote row, narrow its offer metadata to a typed object. */
export function readOfferMetadata(quote: { metadata: unknown }): OfferMetadata {
  const m = quote.metadata as Record<string, unknown> | null | undefined;
  if (!m || typeof m !== 'object') return {};
  const offer = (m as Record<string, unknown>)['offer'];
  if (!offer || typeof offer !== 'object') return {};
  return offer as OfferMetadata;
}

/** Status transition guard. */
export function canTransition(from: string, to: OfferStatus): boolean {
  switch (to) {
    case 'sent':      return from === 'draft' || from === 'sent'; // resend allowed
    case 'viewed':    return from === 'sent' || from === 'viewed';
    case 'accepted':  return from === 'sent' || from === 'viewed';
    case 'declined':  return from === 'sent' || from === 'viewed';
    case 'expired':   return from === 'sent' || from === 'viewed';
    case 'cancelled': return from === 'draft' || from === 'sent' || from === 'viewed';
    default:          return false;
  }
}

/**
 * Raised when a guarded transition finds the row has moved on since the
 * caller's unlocked read — the loser of a concurrent offer-lifecycle race.
 * Callers must answer 409 (not 500) and roll the rest of the transaction back.
 */
export class OfferTransitionLost extends Error {
  constructor(to: OfferStatus) {
    super(`Offer can no longer transition to '${to}' — its state changed concurrently`);
    this.name = 'OfferTransitionLost';
  }
}

/**
 * #3159: the conditional half of every offer lifecycle transition.
 *
 * canTransition() has already vetted the in-memory row, but that read is
 * unlocked — a concurrent accept/cancel/GET could have written the status in
 * between, and an unconditional `UPDATE ... WHERE id = ...` let the later
 * commit silently overwrite a terminal state (a buyer's acceptance vanishing
 * into 'cancelled', a GET regressing 'accepted' to 'viewed'). Folding the
 * allowed source states into the WHERE and reading the write back with
 * .returning() means Postgres re-checks the status against the locked row
 * version: the loser of the race updates zero rows and finds out.
 *
 * `quotes.status` is NOT NULL DEFAULT 'draft' (drizzle/schema/crm.ts), so a
 * plain in-array needs no null arm. Returns whether the write landed; the
 * caller threads the same tx into its sibling writes so a loss throws them
 * all away.
 */
export async function transitionOfferStatus(
  client: DbClient,
  quoteId: string,
  allowedFrom: readonly OfferStatus[],
  set: PgUpdateSetSource<typeof quotes>,
): Promise<boolean> {
  const rows = await client
    .update(quotes)
    .set(set)
    .where(and(eq(quotes.id, quoteId), inArray(quotes.status, [...allowedFrom])))
    .returning({ id: quotes.id });
  return rows.length > 0;
}

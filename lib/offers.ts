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
import { eq, and, sql, isNull } from 'drizzle-orm';

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
 */
export async function findOfferByToken(publicToken: string) {
  if (!publicToken || publicToken.length < 16) return null;

  const row = await db.query.quotes.findFirst({
    where: and(
      sql`(${quotes.metadata}->'offer'->>'public_token') = ${publicToken}`,
      isNull(quotes.deletedAt),
    ),
  });
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

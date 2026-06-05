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
import { db } from '@/drizzle/db';
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
  const base = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
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

/** Patch the `metadata.offer` jsonb sub-tree without clobbering siblings. */
export async function patchOfferMetadata(quoteId: string, tenantId: string, patch: Partial<OfferMetadata>): Promise<void> {
  await db
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

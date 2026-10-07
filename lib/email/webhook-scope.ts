/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { emailTracking } from '@/drizzle/schema';

/**
 * #2406 — which workspace does an inbound provider event belong to?
 *
 * POST /api/webhooks/resend is authenticated with ONE platform-wide secret and
 * the payload carries no tenant. The handlers used to match recipients by
 * email address alone, and `contacts.email` has no global unique index (two
 * customers may hold the same person), so a single hard bounce suppressed
 * marketing in every workspace holding that address and cancelled their
 * sequence enrollments in the same transaction.
 *
 * There is no per-tenant provider configuration to key on either: sending goes
 * through one platform Resend account and one `SMTP_FROM_EMAIL`, so the `from`
 * address identifies the platform, not a customer. The only fact that does
 * identify a workspace is our own send record — `email_tracking`, written per
 * sequence email with the tenant, the contact and the recipient.
 *
 * So attribution is, in order:
 *  1. exact — the event's `email_id` matches the provider message id we stored
 *     when sending (#2406 partner change in lib/email/tracking.ts);
 *  2. unique mailer — exactly one workspace has ever been sent to this
 *     address, so the bounce can only belong to it;
 *  3. otherwise unattributed, and the caller DROPS the event.
 *
 * (3) is deliberate. Choosing "apply to every workspace holding this address"
 * keeps the leak; choosing "the most recent send" is a guess that writes a
 * compliance flag against a customer's data on a guess. A dropped event costs
 * one stale `do_not_contact` on the workspace we could not identify; a wrong
 * one silently suppresses another customer's mailing list with no audit trail.
 * Events we cannot attribute are logged for that reason.
 */
export type EventIdentity = {
  /** `event.data.email_id` — Resend's message id; null when absent. */
  emailId: string | null;
  /** Lower-cased recipient address from the event. */
  recipient: string;
};

export type RecipientScope =
  /** A specific contact row in a specific workspace. */
  | { kind: 'exact'; tenantId: string; contactId: string }
  /** A workspace, contact resolved by address inside it. */
  | { kind: 'tenant'; tenantId: string }
  | {
      kind: 'unattributed';
      reason: 'no-send-record' | 'ambiguous';
      /** Workspaces that have mailed this address (empty for no-send-record). */
      candidates: string[];
    };

/** A scope a write may be made under: one workspace, optionally one contact. */
export type AttributedScope = Extract<RecipientScope, { kind: 'exact' | 'tenant' }>;

/**
 * The policy, split out from the queries so it can be tested without a
 * database. `exactMatch` is the message-id hit, `mailers` the distinct
 * tenant ids that have ever sent to this address.
 */
export function chooseScope(
  exactMatch: { tenantId: string; contactId: string | null } | null,
  mailers: string[],
): RecipientScope {
  if (exactMatch?.contactId) {
    return { kind: 'exact', tenantId: exactMatch.tenantId, contactId: exactMatch.contactId };
  }
  if (exactMatch) return { kind: 'tenant', tenantId: exactMatch.tenantId };

  const tenants = [...new Set(mailers)].filter(Boolean);
  if (tenants.length === 1) return { kind: 'tenant', tenantId: tenants[0]! };
  if (tenants.length === 0) return { kind: 'unattributed', reason: 'no-send-record', candidates: [] };
  return { kind: 'unattributed', reason: 'ambiguous', candidates: tenants.sort() };
}

/** The message-id lookup: exact send, exact contact. */
async function findByMessageId(emailId: string): Promise<{ tenantId: string; contactId: string | null } | null> {
  const [row] = await db
    .select({ tenantId: emailTracking.tenantId, contactId: emailTracking.contactId })
    .from(emailTracking)
    .where(eq(emailTracking.messageId, emailId))
    .limit(1);
  return row ?? null;
}

/** Every workspace we have ever mailed this address to. */
async function tenantsThatMailed(recipient: string): Promise<string[]> {
  const rows = await db
    .select({ tenantId: emailTracking.tenantId })
    .from(emailTracking)
    .where(sql`LOWER(${emailTracking.recipient}) = ${recipient.toLowerCase()}`)
    .groupBy(emailTracking.tenantId);
  return rows.map((r) => r.tenantId);
}

export async function resolveRecipientScope(ev: EventIdentity): Promise<RecipientScope> {
  const exact = ev.emailId ? await findByMessageId(ev.emailId) : null;
  if (exact) return chooseScope(exact, []);
  const mailers = await tenantsThatMailed(ev.recipient);
  return chooseScope(null, mailers);
}

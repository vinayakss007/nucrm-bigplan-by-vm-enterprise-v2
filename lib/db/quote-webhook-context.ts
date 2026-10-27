/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The pre-auth payment-callback claim (#3246 step 4c), its own module the way #2472
 * split the portal lookup, #3163 the form capture and #3246 step 2 the plugin webhook —
 * `lib/db/rls.ts` is under the #1843/#422 500-line ratchet.
 *
 * `POST /api/webhooks/payu` authenticates with PayU's hash over the post body, so it has
 * to resolve the quote named in `txnid` before it knows which workspace the payment
 * belongs to. `quotes`' shipped arms key on `app.current_tenant` (which the pool pins to
 * '' — so nothing) and on the offer `public_token` (which the callback does not carry), so
 * that read matched zero rows for every real payment. Migration 0141 adds the SELECT-only
 * arm this module names: one row by primary key, no tenant widening, nothing once the GUC
 * is cleared. The quote id proves nothing on its own — the verified hash over the txnid
 * that carries it is what the caller had to show — and it grants a read, never a write.
 *
 * `app.quote_webhook_id` joins BOTH connection-reset lists (`lib/db/pool.ts`,
 * `lib/db/request-connection.ts`), as #2446 requires of every privilege GUC.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, type RlsTransaction } from '@/lib/db/rls';
import { isUuid } from '@/lib/id';

/** The GUC migration 0141's claim arm keys off. A constant so both reset lists can name it. */
export const QUOTE_WEBHOOK_GUC = 'app.quote_webhook_id';

/**
 * 0141's clause casts this value, and it arrives from a form field (`txnid`), so a
 * malformed claim has to be refused here rather than reach the policy. The arm guards its
 * own cast and would deny rather than raise, which is the point: measured, the bare-cast
 * version aborted the callback's transaction with 22P02 instead of rejecting the read.
 */
export function quoteWebhookValue(quoteId: string): string {
  const value = (quoteId ?? '').trim();
  if (!value) {
    throw new Error('[RLS] quote webhook claim called with an empty quoteId — refusing to open a context that can name no row');
  }
  if (!isUuid(value)) {
    throw new Error(`[RLS] quote webhook claim quoteId "${value.slice(0, 40)}" is not a uuid — 0141's clause casts it, so this would be a 22P02 on a public payment callback`);
  }
  return value;
}

/** Transaction-local by construction: a claim that outlived its read is the leak #2446 is about. */
export async function setQuoteWebhookLookupContext(tx: RlsTransaction, quoteId: string): Promise<void> {
  const value = quoteWebhookValue(quoteId);
  if (isMockClient(tx)) return;
  await tx.execute(sql`SELECT set_config(${QUOTE_WEBHOOK_GUC}, ${value}, true)`);
}

/**
 * Run `fn` in one transaction carrying 0141's claim on exactly one quote row.
 *
 * Keep the callback to the lookup: the workspace it learns is adopted by the caller in a
 * second, tenant-scoped transaction, so the claim is closed by COMMIT and never names a
 * tenant while it is open.
 */
export async function withQuoteWebhookLookupContext<T>(
  quoteId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = quoteWebhookValue(quoteId);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setQuoteWebhookLookupContext(tx, value);
    return fn(tx);
  });
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The pre-auth WhatsApp integration claim (#3246 step 4d), in its own module the way
 * #2472 split the portal lookup and #3163 the form capture — `lib/db/rls.ts` is under
 * the #1843/#422 500-line ratchet.
 *
 * `POST /api/webhooks/whatsapp` authenticates with Meta's `sha256=…` HMAC over the raw
 * body, then has to find the `integrations` row whose `config->>'phone_number_id'` the
 * payload names before it knows whose message arrived. That table's only arm,
 * `tenant_isolation`, keys on `app.current_tenant` — which both reset lists pin to '' —
 * and `integrations.tenant_id` is NOT NULL, so the read matched zero rows and the
 * processor skipped every message while the route answered 200. Migration 0142 adds the
 * SELECT-only arm this module names. The phone id arrives from a request body, so the
 * claim is validated here rather than trusted by the policy.
 *
 * `app.whatsapp_phone_number_id` joins BOTH connection-reset lists (`lib/db/pool.ts`,
 * `lib/db/request-connection.ts`), as #2446 requires of every privilege GUC.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, type RlsTransaction } from '@/lib/db/rls';

/** The GUC migration 0142's claim arm keys off. A constant so both reset lists can name it. */
export const WHATSAPP_PHONE_GUC = 'app.whatsapp_phone_number_id';

/**
 * Meta's `phone_number_id` is compared as text inside a jsonb column, so unlike 0139/0141
 * there is no `::uuid` for a malformed claim to turn into a `22P02`. That also means a
 * shape rule would be a routing rule: a tenant that typed its number with punctuation into
 * the settings field has that string in `config`, and refusing to claim it would answer 500
 * where today's answer is "no integration found". So this guards only what cannot name a
 * row — empty — and what does not belong in a GUC: control characters, or more than 64.
 */
export function whatsappPhoneValue(phoneNumberId: string): string {
  const value = (phoneNumberId ?? '').trim();
  if (!value) {
    throw new Error('[RLS] WhatsApp integration claim called with an empty phone_number_id — refusing to open a context that can name no row');
  }
  if (value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`[RLS] WhatsApp integration claim phone_number_id of length ${value.length} is not a claimable value — 0142 compares it to a config string, so this names no integration`);
  }
  return value;
}

/** Transaction-local by construction: a claim that outlived its read is the leak #2446 is about. */
export async function setWhatsAppIntegrationLookupContext(tx: RlsTransaction, phoneNumberId: string): Promise<void> {
  const value = whatsappPhoneValue(phoneNumberId);
  if (isMockClient(tx)) return;
  await tx.execute(sql`SELECT set_config(${WHATSAPP_PHONE_GUC}, ${value}, true)`);
}

/**
 * Run `fn` in one transaction carrying 0142's claim on exactly the integration that owns
 * this phone number. Keep the callback to the lookup: the caller adopts the row's tenant
 * with `withTenantContext` in a second transaction, the way #3246 step 4c hands over.
 */
export async function withWhatsAppIntegrationLookupContext<T>(
  phoneNumberId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = whatsappPhoneValue(phoneNumberId);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setWhatsAppIntegrationLookupContext(tx, value);
    return fn(tx);
  });
}

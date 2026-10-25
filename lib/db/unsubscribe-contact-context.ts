/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The pre-auth unsubscribe claim (#3237), its own module the way #2472 split the
 * portal lookup into `lib/db/portal-lookup-context.ts` and #3163 split the form
 * capture into `lib/db/form-capture-context.ts` — `lib/db/rls.ts` is under the
 * #1843/#422 500-line ratchet, and this privilege is self-contained: one GUC
 * naming one contact row, the policy behind it (`0138_pre_auth_unsubscribe_contact_rls.sql`),
 * and the statement that hands the discovered tenant to the rest of the request.
 *
 * WHY THIS EXISTS
 * ---------------
 * `GET|POST /api/unsubscribe` is the RFC 8058 one-click target. It authenticates
 * with an HMAC over the contact uuid, verifies it in application code, and then
 * writes the opt-out. That write was a silent no-op: `contacts`' only arm was
 * `tenant_isolation`, keyed on `app.current_tenant`, which a mail client cannot
 * supply and which both reset lists pin to '' on every checkout. Measured as the
 * application role on the force-RLS dev database — the route's `UPDATE … RETURNING`
 * yields `UPDATE 0` with no context and `UPDATE 1` once the tenant is named from
 * outside the query, so a verified link for a live contact answered 404 "Contact
 * not found" and the contact stayed subscribed.
 *
 * The credential here grants a row without being stored anywhere, so the value the
 * grant keys on is what the token certifies: the contact id. That is 0132's
 * single-GUC id-claim shape, and it is deliberately NOT:
 *  * `app.token_credential` — that slot names a *bearer value* the caller presents
 *    (a reset hash, an OAuth code, a refresh token) and three other tables' arms
 *    compare it against their own column. A contact uuid does not belong there;
 *    #3225 minted `app.oauth_client_id` rather than stretch it for the same reason.
 *  * `app.auth_lookup` — that flag means "this request is doing a credential
 *    lookup", SELECT only ("a claim is a mutation. Mixing them would let a lookup
 *    context also write", `lib/db/token-credential-context.ts`). This is a write.
 *  * `app.is_super_admin` — #2253 measured one SET flipping 60 policies across 49
 *    tables to cross-tenant.
 *
 * `app.unsubscribe_contact` therefore joins BOTH connection-reset lists
 * (`lib/db/pool.ts`, `lib/db/request-connection.ts`), as #2446 requires of every
 * privilege GUC: one that survives a pool checkout is handed to an unrelated
 * request under PgBouncer, and this one selects which contact a stranger may edit.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';
import { isUuid } from '@/lib/id';

/** The GUC migration 0138's claim arms key off. Named as a constant so the reset
 *  on pooled checkout can list the same string. */
export const UNSUBSCRIBE_CONTACT_GUC = 'app.unsubscribe_contact';

/**
 * Validate the contact id an unsubscribe link names, or throw.
 *
 * 0138's predicate casts this value to `uuid`, so an unvalidated string would make
 * Postgres abort with `22P02 invalid input syntax for type uuid` — a 500 on a
 * public endpoint, the class #2288 removed from this route's body handling. The
 * route verifies the HMAC before calling this, so a malformed id cannot reach
 * Postgres from the outside; this is the backstop that keeps a *future* caller
 * from turning a public link into a database error. `contacts.id` is a uuid column,
 * so only `gen_random_uuid()`'s canonical spelling is accepted — a structured id
 * (`ACME-CN-…`) cannot be stored there.
 */
export function unsubscribeContactValue(contactId: string): string {
  const value = (contactId ?? '').trim();
  if (!value) {
    throw new Error('[RLS] unsubscribe claim called with an empty contactId — refusing to open a write context that can name no row');
  }
  if (!isUuid(value)) {
    throw new Error(`[RLS] unsubscribe claim contactId "${value.slice(0, 40)}" is not a uuid — 0138's clause casts it, so this would be a 22P02 on a public endpoint`);
  }
  return value;
}

/**
 * Mark the transaction as claiming one contact for an opted-out link.
 *
 * Transaction-local (`SET LOCAL`) by construction: this module only takes a `tx`,
 * because a privilege that outlives the claim it was opened for is exactly the
 * leak #2446 is about, and there is no legitimate bare-checkout caller here.
 */
export async function setUnsubscribeContactContext(tx: RlsTransaction, contactId: string): Promise<void> {
  const value = unsubscribeContactValue(contactId);
  if (isMockClient(tx)) return;
  await tx.execute(sql`SELECT set_config(${UNSUBSCRIBE_CONTACT_GUC}, ${value}, true)`);
}

/**
 * Close the claim and name the contact's own tenant, in one statement.
 *
 * Called after the claim UPDATE has returned the row's `tenant_id`, so the two
 * writes that still need a workspace — cancelling the sequence enrollments and
 * logging the activity — run under `tenant_isolation` exactly as they do today.
 * 0138 grants nothing on those tables, and the claim GUC is cleared in the same
 * round trip so it does not outlive the one UPDATE it exists for (PP-028: one
 * statement per context change; `setAuthResolutionContext` clears in the same way).
 */
export async function setUnsubscribeTenantContext(tx: RlsTransaction, tenantId: string): Promise<void> {
  if (!tenantId) {
    throw new Error('[RLS] setUnsubscribeTenantContext called with an empty tenantId — refusing to set an empty context');
  }
  if (isMockClient(tx)) return;
  await tx.execute(
    sql`SELECT set_config(${UNSUBSCRIBE_CONTACT_GUC}, '', true),
               set_config('app.current_tenant', ${tenantId}, true),
               set_config('app.current_user', ${NO_USER_SENTINEL}, true)`
  );
}

/**
 * Run `fn` in one transaction carrying 0138's claim on exactly one contact row.
 *
 * Keep the callback to the claim and the writes that follow it, as the other
 * contexts here do. `route.ts` opens this only after `verifyUnsubscribeToken`
 * passed: the id inside the GUC is a privilege, and the HMAC is what says the
 * caller earned it.
 */
export async function withUnsubscribeContactContext<T>(
  contactId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = unsubscribeContactValue(contactId);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setUnsubscribeContactContext(tx, value);
    return fn(tx);
  });
}

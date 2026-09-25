/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tenant-carrier for RLS tenant isolation (PP-027).
 *
 * PROBLEM
 * -------
 * `setTenantContext()` sets `app.current_tenant` / `app.current_user` as
 * SESSION-scoped GUCs on whatever connection that one statement grabbed.
 * Behind PgBouncer (transaction pooling, `PGBOUNCER_ENABLED=true` — which is
 * how pre-prod AND production run) a session-scoped GUC is only as durable as
 * the server connection it happened to land on: `server_reset_query =
 * 'DISCARD ALL'` wipes it on release, and the next statement — in particular
 * the `BEGIN` of a bare `db.transaction()` — routinely lands on a DIFFERENT
 * server connection whose GUCs are empty. The fail-closed RLS policy then
 * denies the write. This is exactly what broke `POST /api/tenant/contacts`
 * (D1 in the live API E2E: `new row violates row-level security policy for
 * table "contacts"`) while reads on the same route kept passing by luck of
 * connection reuse under sequential load.
 *
 * FIX
 * ---
 * `setTenantContext()` records `{ tenantId, userId }` in this AsyncLocalStorage
 * carrier, and the global `db` proxy (drizzle/db.ts) re-applies them as
 * TRANSACTION-scoped (`SET LOCAL`) GUCs at the start of every bare
 * `db.transaction()` that runs inside the same async scope. Transaction scope
 * is pinned to the transaction's own server connection by definition, so the
 * context cannot be lost no matter which server connection PgBouncer assigns.
 *
 * SCOPING (why a plain enterWith in setTenantContext is not enough)
 * ----------------------------------------------------------------
 * `requireAuth()` opens and closes its own ALS scopes (`withRequestId`,
 * `withPinnedConnection`) before returning, so a store written with
 * `enterWith` inside `requireAuth` would die with its scope and be invisible
 * to the handler's later `db.transaction()`. Instead the SCOPE is opened
 * outermost — `withApiRoute` / `withTenantScope` wrap the whole handler body
 * in `runWithTenantCarrier` — and `setTenantCarrier` MUTATES that scoped
 * object, which the handler continuation shares. Outside such a scope (bare
 * routes, workers) it falls back to `enterWith`, which still covers nested
 * continuations created after the call.
 *
 * SAFETY
 * ------
 * - AsyncLocalStorage is per-async-context: unlike pool GUCs, the stash can
 *   never leak across requests. `clearTenantContext()` clears it.
 * - Explicit per-transaction contexts (`withTenantContext`,
 *   `withSecurityContext`, …) run AFTER the carrier re-apply inside the same
 *   transaction, so an explicit context always wins over the carried one.
 * - The carried values are exactly the ones the session scope already
 *   granted, so no privilege is expanded — this only makes the grant durable.
 * - Leaf module: imports `async_hooks` only, so `lib/db/rls.ts`,
 *   `drizzle/db.ts` and `lib/api/with-api-route.ts` can use it without an
 *   import cycle.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface TenantCarrier {
  tenantId: string;
  userId: string;
}

const storage = new AsyncLocalStorage<TenantCarrier | undefined>();

/**
 * Open a carrier scope for a whole request handler body. The object is shared
 * (by mutation) with every nested continuation, including code that runs
 * after `requireAuth()` returns.
 */
export function runWithTenantCarrier<T>(fn: () => T): T {
  return storage.run({ tenantId: '', userId: '' }, fn);
}

/**
 * Record the proven tenant identity. Mutates the enclosing carrier scope when
 * there is one (the normal `withApiRoute` case); otherwise stashes it for
 * nested continuations.
 */
export function setTenantCarrier(tenantId: string, userId: string): void {
  const existing = storage.getStore();
  if (existing) {
    existing.tenantId = tenantId;
    existing.userId = userId;
  } else {
    storage.enterWith({ tenantId, userId });
  }
}

/** Read the stashed tenant identity, if any. */
export function getTenantCarrier(): TenantCarrier | undefined {
  const carrier = storage.getStore();
  return carrier?.tenantId && carrier?.userId ? carrier : undefined;
}

/** Drop the stashed tenant identity. */
export function clearTenantCarrier(): void {
  const existing = storage.getStore();
  if (existing) {
    existing.tenantId = '';
    existing.userId = '';
  } else {
    storage.enterWith(undefined);
  }
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Per-request connection pinning for RLS tenant isolation (#1615).
 *
 * PROBLEM (default, non-PgBouncer deploy):
 * The global `db` (drizzle/db.ts) is a Proxy over drizzle(getPool()). Every
 * top-level db.execute/db.select checks out a FRESH pooled connection and
 * releases it immediately — there is NO connection affinity across a request.
 * setTenantContext(no tx) sets app.current_tenant as a SESSION GUC
 * (is_local=false) on whatever connection that one statement grabbed, which is
 * then released (and reset by pool.on('release')). The request's later data
 * queries run on DIFFERENT connections whose GUC is empty, so the fail-closed
 * RLS policy denies every row. RLS is effectively non-functional as
 * defense-in-depth.
 *
 * FIX:
 * Pin exactly ONE PoolClient per request in an AsyncLocalStorage scope. The
 * tenant GUC is set on THAT client, and the global `db` proxy routes all
 * queries to it for the request's lifetime (see drizzle/db.ts). Because the
 * client stays checked out for the whole request, the SESSION GUC persists
 * across every subsequent query. On scope exit the GUCs are reset and the
 * client is released back to the pool. This pins only one connection per
 * request (no pool-wide serialization) and requires NO changes to the route
 * handlers that use `db` directly.
 *
 * PgBouncer path (PGBOUNCER_ENABLED==='true'): this is a NO-OP. In PgBouncer
 * transaction mode the existing tx/session semantics already work and pinning
 * is unnecessary, so withPinnedConnection() simply runs the callback without
 * acquiring or pinning a client, preserving that path exactly.
 *
 * SCOPE BOUNDARY (honest residual — #1615):
 * AsyncLocalStorage scopes are strictly lexical: the pin is active only for the
 * duration of the callback passed to withPinnedConnection(). It is applied
 * inside requireAuth() (lib/auth/middleware.ts) and requireTenantCtx()
 * (lib/tenant/context.ts), so it covers the auth + setTenantContext +
 * auth/membership lookups. Those helpers RETURN before the route handler (or
 * Server Component page) runs its own data queries in the same function scope,
 * and Next.js App Router exposes no global per-request wrapper user code can
 * hook. So handler-level `db` queries that run AFTER requireAuth()/
 * requireTenantCtx() return are OUTSIDE the pinned scope and fall back to the
 * pool-bound db. Application-level tenant_id filters remain the primary scoping
 * mechanism for those; the fail-closed RLS policy is preserved as
 * defense-in-depth and is now functional on the pinned scope (it was inert on
 * the non-PgBouncer path before this fix). A route/page can opt into
 * full-request pinning by wrapping its body in withPinnedConnection(...).
 * Extending pinning to every handler query would require editing every route
 * (out of scope for this bug fix) or a framework hook Next.js does not provide.
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { PoolClient } from 'pg';
import { getPool } from './pool';

interface PinnedConnectionStore {
  client: PoolClient;
}

const pinnedConnectionStorage = new AsyncLocalStorage<PinnedConnectionStore>();

/**
 * True when running behind PgBouncer, where connection pinning is unnecessary
 * (transaction-mode pooling + DISCARD ALL already handle GUC lifecycle).
 */
function isPgBouncerEnabled(): boolean {
  return process.env['PGBOUNCER_ENABLED'] === 'true';
}

/**
 * Returns the PoolClient pinned to the current async request scope, or
 * undefined when no connection is pinned (e.g. background jobs, workers, the
 * PgBouncer path, or code that runs outside withPinnedConnection). Callers
 * that get undefined should fall back to the pool-bound db (drizzle/db.ts does
 * this automatically).
 */
export function getPinnedClient(): PoolClient | undefined {
  return pinnedConnectionStorage.getStore()?.client;
}

/**
 * SQL that resets the tenant GUCs to empty (fail-closed) on a client. Kept in
 * sync with the pool.on('release') reset in lib/db/pool.ts.
 */
const RESET_TENANT_GUCS_SQL =
  "SELECT set_config('app.current_tenant', '', false), set_config('app.current_user', '', false)";

/**
 * Run `fn` with a single PoolClient pinned to the async request scope.
 *
 * - Acquires ONE client from getPool() and enters an AsyncLocalStorage scope so
 *   getPinnedClient() (and therefore the `db` proxy) route queries to it.
 * - In a finally block, resets the tenant GUCs on the client (defense-in-depth,
 *   in addition to the pool's own release handler) and releases the client back
 *   to the pool.
 * - If acquiring the client fails, the error is propagated and no scope is
 *   entered (the request falls back to the pool-bound db, which is fail-closed
 *   under RLS).
 *
 * NO-OP under PgBouncer: when PGBOUNCER_ENABLED==='true' the callback runs
 * directly with no pinned client, preserving the existing behavior exactly.
 */
export async function withPinnedConnection<T>(fn: () => Promise<T>): Promise<T> {
  // PgBouncer path: pinning is unnecessary and would fight transaction-mode
  // pooling. Run the callback unchanged, with no pinned client.
  if (isPgBouncerEnabled()) {
    return fn();
  }

  // If a client is already pinned for this scope (e.g. nested wrapping), reuse
  // it rather than acquiring a second connection — keeps the "one connection
  // per request" guarantee.
  const existing = getPinnedClient();
  if (existing) {
    return fn();
  }

  const client = await getPool().connect();

  try {
    return await pinnedConnectionStorage.run({ client }, fn);
  } finally {
    // Reset the tenant GUCs before returning the client to the pool so no stale
    // context can leak to the next checkout. The pool's own 'release' handler
    // also does this; doing it here too is cheap defense-in-depth and keeps the
    // reset even if the pool handler wiring ever changes.
    try {
      await client.query(RESET_TENANT_GUCS_SQL);
    } catch {
      // Client may be tearing down; the next checkout re-resets. Swallow to
      // avoid masking the original error / unhandled rejections.
    }
    client.release();
  }
}

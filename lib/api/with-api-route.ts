/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Route + Server-Component pinning wrappers for RLS tenant isolation (#1615).
 *
 * WHY THIS EXISTS
 * ---------------
 * The connection-pinning primitive (lib/db/request-connection.ts) makes RLS
 * functional only for the queries that run INSIDE a withPinnedConnection scope.
 * AsyncLocalStorage scopes are strictly lexical, so wrapping only requireAuth()
 * / requireTenantCtx() (whose scopes CLOSE when they return) leaves the route
 * handler's own db queries — the queries #1615 is actually about — running on
 * unpinned pool connections with an empty tenant GUC.
 *
 * withApiRoute() closes that gap: it encloses the ENTIRE handler body (auth +
 * every subsequent db query) in a single withPinnedConnection scope. So
 * requireAuth()'s setTenantContext() AND the handler's later db.select/db.execute
 * calls all share the one pinned connection, and the SESSION-scoped tenant GUC
 * is visible to every query in the request. RLS then blocks a cross-tenant read
 * even when a handler forgets its app-level tenant_id filter — the exact
 * defense-in-depth #1615 requires.
 *
 * NO-OP under PgBouncer: withPinnedConnection() short-circuits when
 * PGBOUNCER_ENABLED==='true', so this wrapper adds no acquire/pin there and the
 * existing transaction-mode semantics are preserved exactly.
 *
 * MIGRATION PATH (route handlers)
 * -------------------------------
 * Convert a route from the bare-export form:
 *
 *     export async function GET(request: NextRequest) {
 *       const ctx = await requireAuth(request);
 *       ...db queries...
 *     }
 *
 * to the wrapped form (behavior identical, plus the pin now covers the queries):
 *
 *     export const GET = withApiRoute(async (request) => {
 *       const ctx = await requireAuth(request);
 *       ...db queries...
 *     });
 *
 * Dynamic routes receive Next.js's second context argument (route params); it is
 * passed through unchanged:
 *
 *     export const GET = withApiRoute(async (request, { params }) => { ... });
 *
 * The wrapper preserves the handler's Response/NextResponse return value and
 * propagates thrown errors unchanged.
 */

import type { NextRequest } from 'next/server';
import { withPinnedConnection } from '@/lib/db/request-connection';
import { trackRequestStart, trackRequestEnd } from '@/lib/db/graceful-shutdown';

/**
 * A Next.js App Router route handler: receives the request and an optional
 * context argument (route params for dynamic routes) and returns a Response (or
 * a promise of one). The context type is generic so each wrapped handler keeps
 * its own precise `{ params: ... }` shape (static routes simply omit it).
 */
export type RouteHandler<C = unknown> = (
  request: NextRequest,
  context: C
) => Promise<Response | undefined | void> | Response | undefined | void;

/**
 * Wrap a Next.js route handler so its ENTIRE body runs inside a single
 * per-request pinned connection scope (#1615). This is the sound path for RLS
 * tenant isolation on the default (non-PgBouncer) deploy: the auth check's
 * setTenantContext() and all of the handler's own db queries share one pinned
 * connection, so the tenant GUC is visible to every query and RLS blocks
 * cross-tenant reads even if an app-level filter is missing.
 *
 * - No-op under PgBouncer (withPinnedConnection short-circuits).
 * - Preserves the handler's Response/NextResponse return value.
 * - Passes the request and the optional route-context (params) through
 *   unchanged, so dynamic routes work without modification. The generic `C`
 *   preserves each handler's own params type.
 * - Propagates thrown errors (the pinned client is still released + GUC-reset
 *   in withPinnedConnection's finally block).
 */
export function withApiRoute<C = unknown>(
  handler: RouteHandler<C>
): (request: NextRequest, context: C) => Promise<Response | undefined | void> {
  return async (request: NextRequest, context: C) => {
    // #H3: register this request as in-flight for the duration of the handler
    // so graceful shutdown actually waits for it to finish before draining the
    // pool. Previously trackRequestStart/End were never called in production,
    // making the drain loop a no-op (inFlightCount stayed 0). The counter is
    // decremented in finally so it can never leak on error/early-return.
    trackRequestStart();
    try {
      return await withPinnedConnection(async () => handler(request, context));
    } finally {
      trackRequestEnd();
    }
  };
}

/**
 * Run a Server Component / server action body inside a single per-request
 * pinned connection scope (#1615). Use this to wrap a page's data-fetch so that
 * requireTenantCtx()'s setTenantContext() and the page's later db queries share
 * one pinned connection.
 *
 * requireTenantCtx() already pins its own body, but the page's queries run after
 * it returns (outside that scope). Wrapping the whole page body with
 * withTenantScope() keeps them all on the pinned connection:
 *
 *     export default async function Page() {
 *       return withTenantScope(async () => {
 *         const ctx = await requireTenantCtx();
 *         ...db queries...
 *         return <View ... />;
 *       });
 *     }
 *
 * No-op under PgBouncer. Preserves the callback's return value and propagates
 * errors (including Next.js redirect()/notFound() control-flow throws).
 */
export function withTenantScope<T>(fn: () => Promise<T>): Promise<T> {
  return withPinnedConnection(fn);
}

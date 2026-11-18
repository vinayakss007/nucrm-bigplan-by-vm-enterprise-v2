/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3405 PR-3A (first slice) — the typed tenant choke point.
 *
 * RLS context is ambient state on a pooled connection while the Drizzle client
 * is a global singleton, so a statement written before `setTenantContext` runs
 * answers zero rows instead of failing. `TenantDb` is the branded handle that
 * can only come out of `withTenantDb`, which sets `app.current_tenant` and
 * `app.current_user` with `SET LOCAL` inside a transaction before handing the
 * client over. A module that accepts `TenantDb` cannot be called with the raw
 * singleton by mistake: the type error is the guard, not a runtime surprise.
 *
 * This slice establishes the API and migrates one lib module; the fleet-wide
 * import ban is the rest of PR-3A and stays tracked by
 * `guard:tenant-db-context`'s shrink-only ledger.
 */
import type { DbClient } from '@/drizzle/db';
import { withTenantContext } from './rls';

declare const tenantBound: unique symbol;

/** A Drizzle client whose connection is proven to carry a tenant GUC. */
export type TenantDb = DbClient & { readonly [tenantBound]: true };

/**
 * Run `fn` with a client bound to one tenant. The GUCs are set with `SET LOCAL`
 * inside the transaction opened by `withTenantContext`, so they cannot leak to
 * another request on a pooled connection.
 */
export async function withTenantDb<T>(
  tenantId: string,
  userId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  return withTenantContext(tenantId, userId, (tx) => fn(tx as unknown as TenantDb));
}

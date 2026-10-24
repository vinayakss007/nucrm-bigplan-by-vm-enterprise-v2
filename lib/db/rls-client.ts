/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The handle-and-seam primitives every RLS context module needs, split out of
 * `lib/db/rls.ts` for the same reason #2472 split the portal lookup context into
 * `lib/db/portal-lookup-context.ts`: `rls.ts` lives under the #1843/#422 500-line
 * ratchet, and a context module that imports those helpers from `rls.ts` while
 * `rls.ts` re-exports the module's helpers is an import cycle. This file is the
 * leaf: it depends on nothing but the `DbClient` type, so `rls.ts` and the
 * credential context can both sit above it.
 */

import type { DbClient } from '@/drizzle/db';

/** Drizzle transaction handle as passed to `with*Context` callbacks and `set*(…, tx)`. */
export type RlsTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

/**
 * Test seam: unit tests mock `@/drizzle/db` with plain `{ select, update,
 * insert, delete }` objects that have no `transaction` / `execute`. In that
 * case there is no RLS to enforce, so context setup becomes a no-op and the
 * `with*` helpers run `fn` directly against the mock. Production always has a
 * real pool, so this branch never triggers outside tests.
 */
export function isMockClient(client: { execute?: unknown } | undefined): boolean {
  return !client || typeof client.execute !== 'function';
}

export function hasTransaction(client: { transaction?: unknown }): boolean {
  return !!client && typeof client.transaction === 'function';
}

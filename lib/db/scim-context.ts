/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3303 — the RLS context a SCIM bearer token earns, and the two narrow windows
 * it borrows.
 *
 * `verifySCIMToken` (lib/scim/index.ts) proves the sender and returns the tenant
 * the token names; it sets no `app.*` GUC. Every query behind it therefore ran
 * with `app.current_tenant` and `app.current_user` cleared, and `users` has no
 * policy a machine token with no acting user can satisfy — `users_read_self` and
 * `users_tenant_member_read` both derive the tenant from `app.current_user`. The
 * IdP was told the directory was empty, and `PATCH`/`DELETE` matched zero rows.
 *
 * Three kinds of privilege cover the three kinds of query the routes make:
 *
 *   * app.current_tenant + app.current_user (NO_USER_SENTINEL) — everything with
 *     `tenant_isolation` already: `tenant_members`, `roles`, `sessions` writes,
 *     the provisioning transaction. This is `withTenantContext`.
 *   * app.scim_tenant (0143) — the two `users` arms, SELECT and UPDATE, keyed on
 *     an ACTIVE membership in the named tenant. A dedicated GUC rather than
 *     app.current_tenant because `users` is shared across workspaces: a tenant
 *     arm on app.current_tenant would let any body that already sets a tenant
 *     context — including anonymous public routes — read a workspace directory.
 *   * one user's own identity (`withScimUserIdentity`) — the two questions that
 *     need cross-tenant truth without cross-tenant visibility: "does this user
 *     have another active workspace" and "revoke this user's sessions". Both are
 *     answered by policies 0127/0088 already key on `app.current_user`
 *     (`tenant_members_self_read`, `sessions_user_own`), for exactly one user.
 *     The GUC is put back in `finally`, and it dies at COMMIT either way.
 *
 * The global email lookups (an account may exist outside this tenant, and an
 * email is a unique cross-tenant identity) run through
 * `withScimEmailLookup`, which borrows the same `app.auth_lookup` window login
 * uses — one SELECT, tx-local, closed again immediately.
 */
import { sql } from 'drizzle-orm';
import {
  isMockClient,
  hasTransaction,
  NO_USER_SENTINEL,
  withTenantContext,
  type RlsTransaction,
} from '@/lib/db/rls';

export async function withScimTenantContext<T>(
  tenantId: string,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  return withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    if (!isMockClient(tx)) {
      await tx.execute(sql`SELECT set_config('app.scim_tenant', ${tenantId}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Run a write sequence atomically when the client can start one. A unit-test
 * double has no `transaction` (and no RLS to enforce), so it runs inline — the
 * same test seam `withTenantContext` uses.
 */
export async function inScimTransaction<T>(
  ctx: RlsTransaction,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!hasTransaction(ctx)) return fn(ctx);
  return ctx.transaction(fn);
}

/**
 * Adopt ONE user's own identity for the shortest sequence that needs it. See
 * the file comment for why this is not a widening of any tenant arm.
 */
export async function withScimUserIdentity<T>(
  tx: RlsTransaction,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (isMockClient(tx)) return fn();
  await tx.execute(sql`SELECT set_config('app.current_user', ${userId}, true)`);
  try {
    return await fn();
  } finally {
    // If `fn` failed the transaction is already aborted, so this reset would
    // raise 25P02 and replace the caller's error with ours. The GUC is
    // transaction-local and dies at ROLLBACK regardless.
    await tx.execute(sql`SELECT set_config('app.current_user', ${NO_USER_SENTINEL}, true)`).catch(() => {});
  }
}

/**
 * The pre-auth `users` read that `handleLogin` uses, scoped to one statement:
 * `users_auth_lookup` admits SELECT when `app.auth_lookup = 'true'`. Closed in
 * `finally` so the flag cannot authorise a later statement in the same tx.
 */
export async function withScimEmailLookup<T>(tx: RlsTransaction, fn: () => Promise<T>): Promise<T> {
  if (isMockClient(tx)) return fn();
  await tx.execute(sql`SELECT set_config('app.auth_lookup', 'true', true)`);
  try {
    return await fn();
  } finally {
    // Same aborted-transaction caveat as withScimUserIdentity above.
    await tx.execute(sql`SELECT set_config('app.auth_lookup', '', true)`).catch(() => {});
  }
}

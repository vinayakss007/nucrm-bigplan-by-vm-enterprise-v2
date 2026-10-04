/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Row Level Security (RLS) Helper
 * Sets tenant context for database-enforced isolation
 *
 * IMPORTANT: PgBouncer is configured in transaction mode (pool_mode = transaction).
 * - When a `tx` is provided: uses is_local=true (transaction-scoped, clears at COMMIT)
 * - When no `tx` is provided: uses is_local=false (session-scoped, persists on the
 *   connection until PgBouncer reclaims it). PgBouncer's server_reset_query = 'DISCARD ALL'
 *   clears the GUC when the connection returns to the pool.
 *
 * This ensures the tenant GUC survives across multiple statements within one request
 * while never leaking to another request's connection checkout.
 */

import { db, type DbClient } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { setTenantCarrier, clearTenantCarrier } from '@/lib/db/tenant-carrier';

/** Drizzle transaction handle as passed to `with*Context` callbacks and `set*(…, tx)`. */
export type RlsTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

/**
 * Test seam: unit tests mock `@/drizzle/db` with plain `{ select, update,
 * insert, delete }` objects that have no `transaction` / `execute`. In that
 * case there is no RLS to enforce, so context setup becomes a no-op and the
 * `with*` helpers run `fn` directly against the mock. Production always has a
 * real pool, so this branch never triggers outside tests.
 */
function isMockClient(client: { execute?: unknown } | undefined): boolean {
  return !client || typeof client.execute !== 'function';
}

function hasTransaction(client: { transaction?: unknown }): boolean {
  return !!client && typeof client.transaction === 'function';
}

/**
 * Value carried by `app.current_tenant` for a platform console session with no
 * workspace selected. It has to parse as a uuid: every tenant-isolated policy
 * casts the setting (`NULLIF(current_setting('app.current_tenant'),'')::uuid`),
 * so a text sentinel made Postgres abort with `invalid input syntax for type
 * uuid` and the whole super admin console 500ed as soon as an admin had no
 * `users.last_tenant_id`. The nil UUID casts and matches no tenant row.
 */
export const NO_TENANT_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Value carried by `app.current_user` when the request genuinely has no user.
 * Same nil UUID, separate name, because the two GUCs mean different things:
 * "no workspace selected" and "nobody is acting". `setUserContext` refuses an
 * empty userId, and policies cast the setting to uuid, so a request that has to
 * write tenant data while unauthenticated still needs a uuid-shaped value —
 * `/api/track/open` stamping an "Email opened" activity for a recipient who is
 * not a CRM user, for instance. It matches no `users` row, so any policy keyed
 * on the actor stays closed.
 */
export const NO_USER_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Set tenant context for RLS policies.
 *
 * Call sites:
 * - lib/auth/middleware.ts (6 sites) — no tx, session-scoped
 * - lib/tenant/context.ts (2 sites) — no tx, session-scoped
 * - lib/notifications.ts (via withTenantContext) — tx-scoped
 */
export async function setTenantContext(tenantId: string, userId: string, tx?: RlsTransaction): Promise<void> {
  if (!tenantId || !userId) {
    throw new Error('[RLS] setTenantContext called with empty tenantId or userId — refusing to set empty context');
  }
  try {
    const client = tx || db;
    if (isMockClient(client)) return;
    // PP-027: stash the proven identity so bare `db.transaction()` calls later
    // in this request can re-apply it transaction-scoped (session GUCs do not
    // survive PgBouncer transaction pooling — see lib/db/tenant-carrier.ts).
    setTenantCarrier(tenantId, userId);
    // When tx is provided: is_local=true scopes to that transaction.
    // When tx is absent: is_local=false keeps the GUC for the connection's checkout.
    // PgBouncer's server_reset_query='DISCARD ALL' clears it on return to pool.
    const isLocal = tx ? sql`true` : sql`false`;
    await client.execute(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, ${isLocal}), set_config('app.current_user', ${userId}, ${isLocal})`
    );
  } catch (error) {
    console.error('[RLS] Failed to set tenant context:', error);
    throw error;
  }
}

/**
 * Clear tenant context — call at end of request if needed for defence-in-depth.
 * Not strictly required when PgBouncer runs DISCARD ALL on connection return.
 */
export async function clearTenantContext(tx?: RlsTransaction): Promise<void> {
  try {
    const client = tx || db;
    clearTenantCarrier();
    if (isMockClient(client)) return;
    const isLocal = tx ? sql`true` : sql`false`;
    await client.execute(
      sql`SELECT set_config('app.current_tenant', '', ${isLocal}), set_config('app.current_user', '', ${isLocal})`
    );
  } catch (error) {
    console.error('[RLS] Failed to clear tenant context:', error);
  }
}

/**
 * Execute a function with tenant context inside one transaction.
 * The GUC is guaranteed to survive all statements in `fn`.
 */
export async function withTenantContext<T>(
  tenantId: string,
  userId: string,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!tenantId || !userId) {
    throw new Error('[RLS] withTenantContext called with empty tenantId or userId');
  }
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true), set_config('app.current_user', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Name of the GUC that marks a connection as running with platform-security
 * privileges. Postgres-side policies key off this name — see migration
 * 0054 (and 0088, which broadens it to the pre-auth bootstrap paths).
 */
export const SUPER_ADMIN_GUC = 'app.is_super_admin';

/**
 * Mark the current transaction (or, without `tx`, the current connection
 * checkout) as a platform-security context.
 *
 * WHY THIS EXISTS
 * ---------------
 * RLS on this database is deny-by-default for anything that is not
 * tenant-scoped, and several categories of work are legitimately
 * *pre-tenant*: they run before a user or tenant exists, or they maintain
 * platform-wide security state. Without a context they fail with
 * `row-level security` violations, which is what broke first-admin
 * bootstrap, signup, login and the brute-force store in pre-prod
 * (PP-010 / PP-011 / PP-012).
 *
 * IMPORTANT — this is NOT a request-scoped privilege.
 * `SET LOCAL` is transaction-scoped, so it must wrap the *shortest possible*
 * sequence of statements, never a whole request and never a code path that
 * also runs tenant-authored SQL. Callers must use `withSecurityContext()` or
 * pass a `tx`; a bare `setSuperAdminContext()` without `tx` is session-scoped
 * and is only safe on a connection the caller pins and resets.
 *
 * The corresponding reset on connection release (`lib/db/pool.ts` and
 * `lib/db/request-connection.ts`) clears this GUC too, so a leaked context
 * cannot survive a checkout under PgBouncer.
 */
export async function setSuperAdminContext(tx?: RlsTransaction): Promise<void> {
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(sql`SELECT set_config('app.is_super_admin', 'true', ${isLocal})`);
}

/**
 * Run `fn` inside a single transaction that carries the platform-security
 * context for its full duration.
 *
 * Used by the pre-auth bootstrap flows (first super admin, self-service
 * signup, SSO provisioning) and by the login brute-force store. All
 * statements inside `fn` share one connection, so the `SET LOCAL` context
 * cannot leak to unrelated queries and is dropped at COMMIT/ROLLBACK.
 */
export async function withSecurityContext<T>(
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setSuperAdminContext(tx);
    return fn(tx);
  });
}

/**
 * Platform privilege aimed at one specific workspace, in a single statement.
 *
 * #87: callers used to await `setSuperAdminContext(tx)` and then
 * `setTenantContext(tenantId, userId, tx)`. That is one extra statement per
 * transaction (PP-028: a flat ~200 ms), and the impersonation sweep does it
 * once per super admin found, so the overhead scaled with the number of admins
 * rather than the work done. The privilege is unchanged — same three GUCs, same
 * values, all `SET LOCAL` inside the caller's transaction — and it is still
 * exactly as narrow: a tenant is named, so no cross-workspace read opens up.
 *
 * `tx` is required, deliberately. This is the widest context in this module and
 * the only safe lifetime for it is the transaction the caller already owns;
 * a session-scoped version would outlive the statement it was meant to cover.
 */
export async function setImpersonationContext(
  tenantId: string,
  userId: string,
  tx: RlsTransaction
): Promise<void> {
  if (!tenantId || !userId) {
    throw new Error('[RLS] setImpersonationContext called with empty tenantId or userId — refusing to set empty context');
  }
  if (isMockClient(tx)) return;
  setTenantCarrier(tenantId, userId);
  await tx.execute(
    sql`SELECT set_config('app.is_super_admin', 'true', true),
             set_config('app.current_tenant', ${tenantId}, true),
             set_config('app.current_user', ${userId}, true)`
  );
}

/**
 * Set ONLY the acting-user half of the tenant context.
 *
 * For paths where an identity has been *proven* but no workspace has been
 * selected yet — the moment right after a password verifies. The session and
 * `*_own` policies key off app.current_user, so they apply to the proven
 * identity; tenant-scoped tables stay closed because app.current_tenant is
 * still empty. That is exactly the reach a fresh login should have.
 */
export async function setUserContext(userId: string, tx?: RlsTransaction): Promise<void> {
  if (!userId) {
    throw new Error('[RLS] setUserContext called with empty userId — refusing to set empty context');
  }
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(sql`SELECT set_config('app.current_user', ${userId}, ${isLocal})`);
}

/**
 * Mark the transaction as performing a pre-auth credential lookup.
 *
 * `users` has no SELECT policy that an unauthenticated connection can satisfy
 * (read_self needs app.current_user; super_admin_read needs the security
 * context), so `handleLogin`'s `SELECT ... WHERE email = ?` matched zero rows
 * and every login attempt returned "Invalid email or password" no matter what
 * was typed. This GUC admits SELECT on users for exactly that lookup.
 *
 * It is deliberately separate from app.is_super_admin: it grants a single
 * read, never UPDATE or DELETE, so a login request cannot mutate anyone's
 * account beyond what the *_own policies already allow.
 */
export async function setAuthLookupContext(tx?: RlsTransaction): Promise<void> {
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(sql`SELECT set_config('app.auth_lookup', 'true', ${isLocal})`);
}

/**
 * Resolve an identity *from* a verified token: acting user + the pre-auth read
 * privilege, applied in a single statement.
 *
 * #87: the two halves used to be two `SELECT set_config(…)` round-trips. That
 * is the price of *one extra statement* (PP-028: a flat ~200 ms each), paid on
 * every session redemption, i.e. every authenticated request that the
 * AuthContext cache did not already answer. Nothing about the privilege changes
 * here — same two GUCs, same values, same transaction-local scope — only the
 * number of times we ask for them.
 */
export async function setAuthResolutionContext(userId: string, tx?: RlsTransaction): Promise<void> {
  if (!userId) {
    throw new Error('[RLS] setAuthResolutionContext called with empty userId — refusing to set empty context');
  }
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(
    sql`SELECT set_config('app.current_user', ${userId}, ${isLocal}), set_config('app.auth_lookup', 'true', ${isLocal})`
  );
}

/**
 * Run a pre-auth credential lookup (login, SSO subject match) with the minimum
 * read privilege it needs. Keep the callback to the lookup itself.
 */
export async function withAuthLookupContext<T>(
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setAuthLookupContext(tx);
    return fn(tx);
  });
}

/**
 * Mark the transaction as resolving an email-tracking id.
 *
 * `email_tracking` has only `tenant_isolation`, which compares tenant_id to
 * app.current_tenant — a value the tracking endpoints do not know yet, because
 * finding it is the point of the read. See 0105 for why this is its own GUC
 * rather than a share of app.auth_lookup or app.is_super_admin.
 */
export async function setTrackingLookupContext(tx?: RlsTransaction): Promise<void> {
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(sql`SELECT set_config('app.tracking_lookup', 'true', ${isLocal})`);
}

/**
 * Look up one `email_tracking` row by its unguessable id, from a request that
 * has no tenant context (the open pixel, the click redirect).
 *
 * Keep the callback to the lookup itself and return only what the caller needs:
 * this context can SELECT every tenant's tracking rows, so handing it back a
 * whole-tenant query result would turn a narrow privilege into a broad one.
 */
export async function withTrackingLookupContext<T>(
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setTrackingLookupContext(tx);
    return fn(tx);
  });
}

/**
 * Run `fn` inside a transaction scoped to a proven user, with no tenant
 * selected. Used by login/2FA paths that must write their own session or
 * profile rows before a workspace context exists.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!userId) {
    throw new Error('[RLS] withUserContext called with empty userId');
  }
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setUserContext(userId, tx);
    return fn(tx);
  });
}

/**
 * Redeem a *verified* session token — the full pre-tenant read sequence that
 * turns a presented cookie into an AuthContext.
 *
 * Combines two narrow privileges in a single transaction:
 *   app.current_user = userId   (taken from a cryptographically verified
 *                                session token, never from client input)
 *   app.auth_lookup  = 'true'   (admits the keyed sessions/users lookups)
 *
 * WHY BOTH ARE NEEDED (PP-026)
 * The only policy on `sessions` was `sessions_user_own`, whose USING clause
 * keys off app.current_user — the very value the redemption read exists to
 * establish. Chicken and egg: a session minted at login could never be
 * redeemed, so every authenticated request answered 401 "Session expired"
 * while signup/login themselves kept returning 2xx. `tenant_members` and
 * `roles` had the same shape via tenant_isolation (they need a tenant the
 * membership read is supposed to discover); 0088 adds self-scoped SELECT
 * policies for them instead of widening the tenant-bound ones.
 *
 * Read-only by construction: neither GUC grants INSERT/UPDATE/DELETE here.
 */
export async function withAuthResolutionContext<T>(
  userId: string,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!userId) {
    throw new Error('[RLS] withAuthResolutionContext called with empty userId');
  }
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setAuthResolutionContext(userId, tx);
    return fn(tx);
  });
}

/**
 * Verify RLS is enabled on a table
 */
export async function verifyRLSEnabled(tableName: string): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = ${tableName}`
    );
    return (result.rows[0] as { rowsecurity?: boolean })?.rowsecurity ?? false;
  } catch (error) {
    console.error('[RLS] Failed to verify RLS status:', error);
    return false;
  }
}

/**
 * Verify all critical tables have RLS enabled
 */
export async function verifyAllRLSEnabled(): Promise<{ table: string; enabled: boolean }[]> {
  const criticalTables = [
    'contacts',
    'companies',
    'deals',
    'tasks',
    'activities',
    'notes',
    'meetings',
    'automations',
    'notifications',
    'webhook_deliveries',
    'api_keys',
    'audit_logs',
  ];

  const results = await Promise.all(
    criticalTables.map(async (table) => ({
      table,
      enabled: await verifyRLSEnabled(table),
    }))
  );

  return results;
}

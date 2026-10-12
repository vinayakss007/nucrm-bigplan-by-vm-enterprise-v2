/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The portal-credential lookup context (#2446), split out of `lib/db/rls.ts`
 * because that file is under the #1843/#422 500-line ratchet and this block is a
 * self-contained one: three GUC names, the claim rules that fill them, and the
 * single statement that sets them. The tenant-scoped work that follows a lookup
 * still comes from `lib/db/rls.ts` (`withTenantContext`, `NO_USER_SENTINEL`),
 * which is why this module imports from it rather than duplicating anything.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, type RlsTransaction } from '@/lib/db/rls';

/**
 * The three GUC names migration 0122's portal credential policies key off.
 *
 * They are named as constants rather than spliced into a query string so the reset on
 * pooled checkout (`lib/db/pool.ts`, `lib/db/request-connection.ts`) can list
 * the same constants — a privilege GUC that survives a checkout is handed to an
 * unrelated request under PgBouncer, which is why `app.auth_lookup` and
 * `app.tracking_lookup` are in those lists too.
 */
export const PORTAL_LOOKUP_TOKEN_GUC = 'app.portal_lookup_token';
export const PORTAL_LOOKUP_TENANT_GUC = 'app.portal_lookup_tenant';
export const PORTAL_LOOKUP_EMAIL_GUC = 'app.portal_lookup_email';

/** Upper bound on a credential-shaped lookup value, so a request cannot make
 *  the policy compare a 1 MB string against every row's indexed column. */
const PORTAL_LOOKUP_MAX_VALUE_LENGTH = 512;

/**
 * Which credential a portal lookup is being resolved from. Every field is
 * optional, but at least one must be present, and `email` never means anything
 * without the `tenantId` it sits in (0122 keys that arm on the pair, precisely
 * so that "find this address" cannot become "find this address in any
 * workspace" — the spoofing class #1133/#1913 removed from the routes).
 */
export interface PortalLookupClaims {
  /** A presented `portal_clients.access_token` (the `x-portal-token` header). */
  accessToken?: string;
  /** The workspace whose portal is being opened — from the login request, never from a session. */
  tenantId?: string;
  /** The account within `tenantId`, as the session cookie claims it. */
  email?: string;
}

function requireLookupValue(name: string, value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new Error(`[RLS] portal lookup called with an empty ${name} — refusing to open a credential read on nothing`);
  }
  if (trimmed.length > PORTAL_LOOKUP_MAX_VALUE_LENGTH) {
    throw new Error(`[RLS] portal lookup ${name} is longer than ${PORTAL_LOOKUP_MAX_VALUE_LENGTH} characters — no credential is that long`);
  }
  return trimmed;
}

/**
 * Normalise claims into the GUC assignments one `setPortalLookupContext` should
 * issue, or throw. Split out so the rules are unit-testable without a pool:
 * `isMockClient()` short-circuits the real helper in the unit harness.
 */
export function portalLookupSettings(claims: PortalLookupClaims): { guc: string; value: string }[] {
  const settings: { guc: string; value: string }[] = [];
  const token = (claims.accessToken ?? '').trim();
  const tenant = (claims.tenantId ?? '').trim();
  const email = (claims.email ?? '').trim();

  if (token) settings.push({ guc: PORTAL_LOOKUP_TOKEN_GUC, value: requireLookupValue('accessToken', token) });
  if (tenant) settings.push({ guc: PORTAL_LOOKUP_TENANT_GUC, value: requireLookupValue('tenantId', tenant) });
  if (email) {
    if (!tenant) {
      throw new Error(
        '[RLS] portal lookup email without a tenantId — 0122 keys that arm on the (tenant, email) pair, ' +
        'so an email alone grants nothing and a caller that expects one has an unscoped lookup in mind.',
      );
    }
    settings.push({ guc: PORTAL_LOOKUP_EMAIL_GUC, value: requireLookupValue('email', email) });
  }

  if (settings.length === 0) {
    throw new Error('[RLS] portal lookup called with no credential — refusing to set an empty lookup context');
  }
  return settings;
}

/**
 * One statement for a whole lookup context, never one per GUC: PP-028 measured
 * each extra `SELECT set_config(…)` at a flat ~200 ms, and a portal request
 * needs two or three of these at once.
 */
function portalLookupStatement(
  settings: { guc: string; value: string }[],
  isLocal: ReturnType<typeof sql>,
): ReturnType<typeof sql> {
  const parts: ReturnType<typeof sql>[] = settings.map(
    (s) => sql`set_config(${s.guc}, ${s.value}, ${isLocal})`,
  );
  return sql`SELECT ${sql.join(parts, sql`, `)}`;
}

/**
 * Mark the transaction as resolving a customer-portal credential (#2446).
 *
 * WHY A CONTEXT IS NEEDED AT ALL: the portal has to read `portal_clients` or
 * `platform_settings` to learn which tenant the caller belongs to, and those
 * tables' only shipped policy compares `tenant_id` to `app.current_tenant` — a
 * value the request does not have yet, because finding
 * it is the point of the query. Under the fail-closed deparse that is a silent
 * zero-row read, which is why the portal returned 403 "Portal not enabled" and
 * empty lists rather than an error (#2446).
 *
 * This is NOT `withSecurityContext` and NOT a tenant GUC. `app.is_super_admin`
 * was measured (#2253) to flip 60 policies across 49 tables from fail-closed to
 * cross-tenant with one `SET`; `app.current_tenant` for a tenant an anonymous
 * caller named would expose every row of that tenant, including
 * `portal_clients.access_token`, which IS the bearer credential the portal
 * authenticates with. Each 0122 arm can match at most the rows its own
 * credential names.
 *
 * Keep `fn` to the lookup, like `withTrackingLookupContext` says: the SELECT
 * privilege is real, so handing this context back a whole-tenant query turns a
 * narrow read into a broad one.
 */
export async function setPortalLookupContext(
  claims: PortalLookupClaims,
  tx?: RlsTransaction,
): Promise<void> {
  const settings = portalLookupSettings(claims);
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(portalLookupStatement(settings, isLocal));
}

/**
 * Resolve a portal credential with the minimum read it needs — login's config
 * probe and client lookup, `resolvePortalIdentity()`'s token match,
 * `getPortalSession()`'s cookie re-validation. (#2444 retired the fourth user
 * this list carried, the per-ticket `support_tickets.portal_token`, together with
 * 0122's arm for it; nothing reads a ticket as a credential any more.)
 *
 * The tenant-scoped work that FOLLOWS still runs in `withTenantContext()`: this
 * context is SELECT-only and knows no tenant, so it cannot read invoices or
 * write tickets.
 */
export async function withPortalLookupContext<T>(
  claims: PortalLookupClaims,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const settings = portalLookupSettings(claims);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await tx.execute(portalLookupStatement(settings, sql`true`));
    return fn(tx);
  });
}

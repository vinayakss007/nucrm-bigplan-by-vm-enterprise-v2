/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The API-key half of `POST/GET /api/webhooks/inbound` (#3246 step 4a), split out
 * because that route is under the #1843/#422 size ratchet.
 *
 * `api_keys` is FORCE-RLS and its only non-lookup arm is `tenant_isolation`, keyed
 * on `app.current_tenant`. The route is a `proxy.ts` public path, so nothing named a
 * tenant and the lookup read zero rows for every minted key: both handlers answered
 * 401 before parsing a body. 0099 shipped the arm this read needed
 * (`api_keys_auth_lookup`) and `tryApiKeyAuth` already uses it for the same table.
 *
 * Measured on the dev database as `nucrm_app` (temp FORCE-RLS tables carrying the
 * policy text `pg_policies` reports, in a rollback, 2026-10-26): the read is 0 rows
 * with no GUC, 1 under `app.auth_lookup`, 0 when the claim names a different hash;
 * the usage-trail UPDATE touches 0 rows under the claim alone and 1 once the tenant
 * is named; a contact INSERT raises `new row violates row-level security policy`
 * with no context and lands with it. So the two steps below are the claim and the
 * adoption — the same pair `tryApiKeyAuth` performs, in that order.
 */

import { createHash } from 'crypto';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { apiKeys } from '@/drizzle/schema';
import { NO_USER_SENTINEL, setTenantContext, withAuthLookupContext } from '@/lib/db/rls';
// #3291: every resolver of apiKeys.keyHash has to prove the owner is still an
// active member; this is the webhook-side copy of that check.
import { keyOwnerIsLive } from '@/lib/auth/api-key-membership';

export type ResolvedInboundKey = {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  prefix: string;
};

/**
 * Resolve an API key to a tenant and adopt that workspace for the rest of the
 * request. Returns null if the key is invalid, expired, inactive, or — #3291 —
 * its owner no longer holds an active membership in that tenant.
 */
export async function resolveApiKey(rawKey: string): Promise<ResolvedInboundKey | null> {
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const row = await withAuthLookupContext((tx) => tx.query.apiKeys.findFirst({
    // #2459: `api_keys` is 16 columns (drizzle/schema/core.ts:281) and one is
    // `key_hash` — the credential this route exists to check, read here on a
    // proxy.ts public path with no session. These five are what both callers
    // touch; `key_hash` stays a WHERE predicate. tsc proves five is enough.
    columns: { id: true, tenantId: true, userId: true, name: true, prefix: true },
    where: and(
      eq(apiKeys.keyHash, keyHash),
      eq(apiKeys.isActive, true),
      or(
        isNull(apiKeys.expiresAt),
        gt(apiKeys.expiresAt, new Date())
      )
    )
  }));

  if (!row) return null;

  // Nothing else on this path names a tenant, and every write below is keyed on
  // it. `setTenantContext` also stashes the pair for the PP-027 carrier, which is
  // what re-applies it inside a bare `db.transaction` behind a pooler.
  await setTenantContext(row.tenantId, row.userId ?? NO_USER_SENTINEL);

  // #3291: `isActive` is a flag somebody has to remember to clear; an active
  // membership is a fact. Inbound webhook delivery resolves the tenant from a key
  // hash and nothing else, so without this proof a removed member's key keeps
  // writing into that workspace — and keeps bumping `last_used_at`/`call_count`
  // below, which makes the standing credential look like it is still in use by
  // somebody who works there. Runs after `setTenantContext` because
  // `tenant_members` is tenant-isolated: the same reason 0099 gave the key lookup
  // its own privilege.
  if (!await keyOwnerIsLive(row.tenantId, row.userId)) return null;

  // Update last_used_at and call_count
  await db.transaction((tx) =>
    tx.update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        callCount: sql`${apiKeys.callCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, row.id)));

  return row;
}

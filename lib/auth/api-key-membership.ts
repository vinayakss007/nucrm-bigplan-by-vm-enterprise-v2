/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3291 — prove the key's owner is still a member, in the one place RLS can see
 * the row.
 *
 * `tenant_members` is tenant-isolated (`app.current_tenant`) plus
 * `tenant_members_self_read` (0127: `status = 'active' AND user_id =
 * app.current_user`). Both read the GUCs, so the membership read cannot live
 * inside `withAuthLookupContext`: migration 0099 grants `api_keys` SELECT under
 * `app.auth_lookup` precisely because `app.current_tenant` is still empty at
 * that moment — and a `tenant_members` read taken in that window matches zero
 * rows, which is the dead-on-arrival failure 0099 was written to fix. Calling it
 * here would 401 every minted key rather than close the hole.
 *
 * So the proof runs after the caller has adopted the key's workspace via
 * `setTenantContext`, and inside `db.transaction`: PgBouncer pools in transaction
 * mode, so session GUCs do not survive a checkout (PP-027) — the carrier
 * `setTenantContext` stashes is what re-applies them for the statements of one
 * transaction (`lib/db/tenant-carrier.ts`).
 *
 * A throw denies. The alternative is an availability incident answered with the
 * tenant's whole data plane still reachable.
 */
import { db, type DbClient } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

/**
 * The predicate #3291 ask 4 makes an invariant: an owner counts only while their
 * membership row is `status = 'active'` and not soft-deleted, in the tenant the
 * key belongs to. `null`/undefined userId has no proof available, so it is not a
 * member — `api_keys.user_id` is nullable, and an ownerless key is exactly the
 * credential nobody can offboard.
 */
export async function hasActiveMembership(
  tx: DbClient,
  tenantId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const [member] = await tx
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.status, 'active'),
        isNull(tenantMembers.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(member);
}

/**
 * Convenience for callers that hold only a tenant/user pair: the read opens its
 * own transaction so the carried GUC applies, and fails closed.
 */
export async function keyOwnerIsLive(
  tenantId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    return await db.transaction(async (tx) =>
      hasActiveMembership(tx as unknown as DbClient, tenantId, userId),
    );
  } catch (err) {
    await logError({ error: err, context: 'api-key: keyOwnerIsLive' });
    return false;
  }
}

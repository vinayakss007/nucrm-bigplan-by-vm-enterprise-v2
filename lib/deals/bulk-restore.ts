/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { deals, plans, tenants } from '@/drizzle/schema';
import type { db as dbType } from '@/drizzle/db';

export type DealRestoreOutcome =
  | { ok: true; ids: string[]; restored: number }
  | { ok: false; reason: 'nothing-to-restore' }
  | { ok: false; reason: 'over-plan-limit'; maxDeals: number; actual: number };

/**
 * Restore the deals an id list actually refers to (trashed rows), and re-admit them
 * to the plan-counted pool under an in-transaction FOR UPDATE lock (#3409).
 *
 * Sibling of lib/contacts/bulk-restore.ts:
 *  1. Target set: filtered on deletedAt IS NOT NULL.
 *  2. Quota check: priced against the locked counter inside the write transaction
 *     under FOR UPDATE on the tenant row, preventing concurrent restores/imports
 *     from overshooting maxDeals.
 *  3. Counter: atomic COALESCE bump so NULL values cannot increment into NULL.
 */
export async function restoreBulkDeals(
  db: typeof dbType,
  opts: { tenantId: string; ids: string[]; scope?: SQL | undefined; enforceLimits?: boolean },
): Promise<DealRestoreOutcome> {
  const { tenantId, ids, scope, enforceLimits = false } = opts;

  const rows = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        inArray(deals.id, ids),
        eq(deals.tenantId, tenantId),
        sql`${deals.deletedAt} IS NOT NULL`,
        scope,
      )
    );

  if (!rows.length) return { ok: false, reason: 'nothing-to-restore' };

  const restorableIds = rows.map((r) => r.id);
  const now = new Date();

  return db.transaction(async (tx) => {
    if (enforceLimits) {
      const [gated] = await tx
        .select({ currentDeals: tenants.currentDeals, maxDeals: plans.maxDeals })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.id, tenantId))
        .limit(1)
        .for('update');

      const projected = (gated?.currentDeals ?? 0) + restorableIds.length;
      if (gated && gated.maxDeals != null && projected > gated.maxDeals) {
        return { ok: false as const, reason: 'over-plan-limit' as const, maxDeals: gated.maxDeals, actual: projected };
      }
    }

    const res = await tx
      .update(deals)
      .set({ deletedAt: null, deletedBy: null, updatedAt: now })
      .where(
        and(
          inArray(deals.id, restorableIds),
          eq(deals.tenantId, tenantId),
          sql`${deals.deletedAt} IS NOT NULL`
        )
      );

    const restored = res.rowCount ?? 0;
    if (restored > 0) {
      await tx
        .update(tenants)
        .set({ currentDeals: sql`COALESCE(${tenants.currentDeals}, 0) + ${restored}` })
        .where(eq(tenants.id, tenantId));
    }

    return { ok: true as const, ids: restorableIds, restored };
  });
}

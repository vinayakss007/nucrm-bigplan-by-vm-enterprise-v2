/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { contacts, plans, tenants } from '@/drizzle/schema';
import type { db as dbType } from '@/drizzle/db';

export type RestoreOutcome =
  | { ok: true; ids: string[]; restored: number; reAdmitted: number }
  | { ok: false; reason: 'nothing-to-restore' }
  | { ok: false; reason: 'over-plan-limit'; maxContacts: number };

/**
 * Restore the contacts an id list actually refers to — trashed or archived rows —
 * and put the plan-counted pool back the way `delete` took it out. (#3111)
 *
 * Lives in a module rather than in `contacts/bulk/route.ts` because that file sits
 * at the 500-line ceiling the #1843/#422 ratchet measures, and the resolve →
 * lock → check → write sequence below is the part worth reading on its own.
 *
 * Three things the caller cannot get from a bare UPDATE:
 *
 *  1. **The target set.** The bulk route's `validIds` is built with
 *     `deletedAt IS NULL`, so handing it to a restore is a no-op — the shape
 *     `leads/bulk` and `deals/bulk` both retired with a re-resolution against the
 *     tombstone. Contacts also uses `restore` for archive-undo, so this set is
 *     "tombstoned OR archived", not tombstoned alone.
 *  2. **The counter.** `delete` decrements `tenants.currentContacts` by the rows it
 *     tombstoned; only the rows whose tombstone is cleared are re-admitted, so only
 *     those re-increment. Counting archived-but-never-deleted rows here would
 *     inflate the pool on every undo.
 *  3. **The plan gate.** `maxContacts` is checked against the counter as of this
 *     transaction: the tenant row is locked FOR UPDATE *before* the counter is
 *     read, so a concurrent import cannot pass the same check on the same headroom
 *     (the #3080 shape in `leads/import/route.ts`; `deals/bulk` reads its counter
 *     outside the transaction and so cannot promise that).
 */
export async function restoreBulkContacts(
  db: typeof dbType,
  opts: { tenantId: string; ids: string[]; scope?: SQL | undefined },
): Promise<RestoreOutcome> {
  const { tenantId, ids, scope } = opts;

  const rows = await db
    .select({ id: contacts.id, deletedAt: contacts.deletedAt })
    .from(contacts)
    .where(
      and(
        inArray(contacts.id, ids),
        eq(contacts.tenantId, tenantId),
        or(sql`${contacts.deletedAt} IS NOT NULL`, eq(contacts.isArchived, true)),
        scope,
      )
    );

  if (!rows.length) return { ok: false, reason: 'nothing-to-restore' };

  const trashedIds = rows.filter(r => r.deletedAt !== null).map(r => r.id);
  const archivedIds = rows.filter(r => r.deletedAt === null).map(r => r.id);
  const restoredIds = rows.map(r => r.id);
  const now = new Date();

  return db.transaction(async (tx) => {
    if (trashedIds.length) {
      await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);
      const [gated] = await tx
        .select({ currentContacts: tenants.currentContacts, maxContacts: plans.maxContacts })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (gated && gated.maxContacts != null && (gated.currentContacts ?? 0) + trashedIds.length > gated.maxContacts) {
        // Returning before any write is what makes this a refusal rather than a
        // partial restore — the rows stay in the trash with their count intact.
        return { ok: false as const, reason: 'over-plan-limit' as const, maxContacts: gated.maxContacts };
      }
    }

    let reAdmitted = 0;
    let reopened = 0;
    if (trashedIds.length) {
      const res = await tx
        .update(contacts)
        .set({ deletedAt: null, deletedBy: null, isArchived: false, updatedAt: now })
        .where(
          and(
            inArray(contacts.id, trashedIds),
            eq(contacts.tenantId, tenantId),
            sql`${contacts.deletedAt} IS NOT NULL`
          )
        );
      reAdmitted = res.rowCount ?? 0;
      if (reAdmitted > 0) {
        await tx
          .update(tenants)
          .set({ currentContacts: sql`COALESCE(${tenants.currentContacts}, 0) + ${reAdmitted}` })
          .where(eq(tenants.id, tenantId));
      }
    }

    if (archivedIds.length) {
      const res = await tx
        .update(contacts)
        .set({ isArchived: false, updatedAt: now })
        .where(
          and(
            inArray(contacts.id, archivedIds),
            eq(contacts.tenantId, tenantId),
            sql`${contacts.deletedAt} IS NULL`
          )
        );
      reopened = res.rowCount ?? 0;
    }

    return { ok: true as const, ids: restoredIds, restored: reAdmitted + reopened, reAdmitted };
  });
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Per-tenant human-readable lead identifier generator.
 *
 * Format: LD-{YYYY}-{NNN}
 *   LD-2025-001, LD-2025-002, ... resets per calendar year per tenant.
 *
 * Implementation (#2343): locks the tenant row FOR UPDATE inside the caller's
 * transaction, then derives MAX(sequence)+1 from the current year's
 * `lead_oid` values — soft-deleted rows INCLUDED, because a trashed lead
 * keeps its label and numbers must never be reissued. The unique index
 * `(tenant_id, lead_oid)` (migration 0114) turns any residual collision
 * into a loud 23505 the caller can retry. This mirrors the hardened quote
 * (#1611) and invoice (#1462) allocation pattern.
 *
 * The previous COUNT(*)+1 over live rows both raced (no lock, no unique
 * index — the old comment here claimed an index that did not exist) and
 * deterministically reissued labels after a soft delete.
 */

import { eq, sql } from 'drizzle-orm';
import { leads } from '@/drizzle/schema';
import type { db as dbType } from '@/drizzle/db';

export async function generateLeadOid(
  tx: typeof dbType,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();

  await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

  // Bind the regex as a parameter ('^LD-2026-[0-9]+$'): a legacy or
  // previous-year label can never contribute to this year's sequence, and
  // anything not matching the canonical shape (manual edits, imports) is
  // skipped rather than crashing the CAST.
  const oidPattern = `^LD-${year}-[0-9]+$`;
  const [row] = await tx
    .select({
      maxNum: sql<number>`COALESCE(MAX(
        CASE WHEN ${leads.leadOid} ~ ${oidPattern}
        THEN CAST(SUBSTRING(${leads.leadOid} FROM 9) AS integer)
        ELSE 0 END
      ), 0)::int`,
    })
    .from(leads)
    .where(eq(leads.tenantId, tenantId));

  const next = ((row?.maxNum as number) ?? 0) + 1;
  return `LD-${year}-${String(next).padStart(3, '0')}`;
}

/**
 * Narrow retry predicate (#2343): only a violation of the (tenant_id,
 * lead_oid) unique index is re-allocatable. Any other 23505 (e.g. an
 * intentional constraint elsewhere in the tx) must propagate.
 */
export function isLeadOidCollision(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint) return e.constraint === 'idx_leads_tenant_oid';
  return /duplicate key value violates unique constraint "idx_leads_tenant_oid"/.test(err.message);
}

/**
 * Per-tenant human-readable lead identifier generator.
 *
 * Format: LD-{YYYY}-{NNN}
 *   LD-2025-001, LD-2025-002, ... resets per calendar year per tenant.
 *
 * Implementation: counts existing leads in the same year for the tenant
 * and increments. Race-condition-safe enough for human-facing IDs because
 * the underlying primary key is a UUID — `lead_oid` is a label only and
 * the unique index `(tenant_id, lead_oid)` will catch any rare collision
 * at insert time (caller can retry).
 */

import { and, eq, gte, sql, isNotNull, isNull } from 'drizzle-orm';
import { leads } from '@/drizzle/schema';
import type { db as dbType } from '@/drizzle/db';

export async function generateLeadOid(
  tx: typeof dbType,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));

  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        gte(leads.createdAt, yearStart),
        isNotNull(leads.leadOid),
        isNull(leads.deletedAt),
      ),
    );

  const next = (row?.count ?? 0) + 1;
  const padded = String(next).padStart(3, '0');
  return `LD-${year}-${padded}`;
}

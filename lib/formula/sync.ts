/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { withTenantDb } from '@/lib/db';
import { NO_USER_SENTINEL } from '@/lib/db/rls';
import { customFieldDefs } from '@/drizzle/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { formulaEngine } from './engine';
import { logger } from '@/lib/logger';

/**
 * Formula Synchronization Service
 * 
 * Manages re-calculation of calculated fields when data changes.
 */

export async function syncCalculatedFields(
  tenantId: string,
  entityType: string,
  entityId: string,
  recordData: Record<string, unknown>
): Promise<void> {
  try {
    // #3405: definition reads and the metadata write run on one branded
    // tenant client, so the GUC is set on the connection that executes them.
    const defs = await withTenantDb(tenantId, NO_USER_SENTINEL, async (db) =>
      db.select({
        fieldKey: customFieldDefs.fieldKey,
        formula: customFieldDefs.formula
      })
      .from(customFieldDefs)
      .where(and(
        isNull(customFieldDefs.deletedAt),
        eq(customFieldDefs.tenantId, tenantId),
        eq(customFieldDefs.entityType, entityType),
        eq(customFieldDefs.isCalculated, true)
      )));

    if (!defs.length) return;

    // 2. Evaluate each formula
    const updates: Record<string, unknown> = {};
    for (const def of defs) {
      if (!def.formula) continue;
      const value = formulaEngine.evaluate(def.formula, recordData);
      if (value !== null) {
        updates[def.fieldKey] = value;
      }
    }

    if (Object.keys(updates).length === 0) return;

    // 3. Update the metadata column for the entity
    // We merge the new calculated values into the existing metadata
    const tableName = getTableName(entityType);
    if (!tableName) return;

    await withTenantDb(tenantId, NO_USER_SENTINEL, async (db) =>
      db.execute(sql`
        UPDATE public.${sql.identifier(tableName)}
        SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb, updated_at = now()
        WHERE id = ${entityId} AND tenant_id = ${tenantId}
      `));
  } catch (err) {
    // Formula fields are derived data written into metadata. A failure here means
    // the stored values are now stale relative to their inputs, which is a
    // correctness problem for anything reading them (reports, filters, exports).
    logger.error('[FormulaSync] Failed to sync formula fields', {
      tenantId,
      entityType,
      entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function getTableName(entityType: string): string | null {
  const map: Record<string, string> = {
    contact: 'contacts',
    company: 'companies',
    deal: 'deals',
    lead: 'leads',
    task: 'tasks'
  };
  return map[entityType] || null;
}

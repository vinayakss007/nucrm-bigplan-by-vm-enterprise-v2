import { db } from '@/drizzle/db';
import { customFieldDefs } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { formulaEngine } from './engine';

/**
 * Formula Synchronization Service
 * 
 * Manages re-calculation of calculated fields when data changes.
 */

export async function syncCalculatedFields(
  tenantId: string,
  entityType: string,
  entityId: string,
  recordData: Record<string, any>
): Promise<void> {
  try {
    // 1. Fetch all calculated field definitions for this tenant/entity
    const defs = await db.select({
      fieldKey: customFieldDefs.fieldKey,
      formula: customFieldDefs.formula
    })
    .from(customFieldDefs)
    .where(and(
      eq(customFieldDefs.tenantId, tenantId),
      eq(customFieldDefs.entityType, entityType),
      eq(customFieldDefs.isCalculated, true)
    ));

    if (!defs.length) return;

    // 2. Evaluate each formula
    const updates: Record<string, any> = {};
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

    await db.execute(sql`
      UPDATE public.${sql.identifier(tableName)} 
      SET metadata = metadata || \${JSON.stringify(updates)}::jsonb, updated_at = now() 
      WHERE id = \${entityId} AND tenant_id = \${tenantId}
    `);
  } catch (err) {
    console.error(`[FormulaSync] Failed to sync fields for \${entityType} \${entityId}`, err);
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

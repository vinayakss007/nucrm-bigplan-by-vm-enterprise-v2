import { db } from '@/drizzle/db';
import { criticalDataBackups } from '@/drizzle/schema';
import { eq, and, gte, lte, sql, desc, count } from 'drizzle-orm';

const CRITICAL_TABLES = [
  'contacts', 'leads', 'deals', 'companies',
  'tenants', 'tasks', 'tenant_members', 'roles',
  'subscriptions', 'invitations',
];

const RETENTION_DAYS = 90;

export class CriticalDataCapture {
  async captureBeforeDelete(
    tenantId: string,
    tableName: string,
    recordIds: string[],
    deletedBy?: string
  ): Promise<number> {
    if (!CRITICAL_TABLES.includes(tableName)) return 0;

    let captured = 0;

    for (const recordId of recordIds) {
      try {
        const result = await db.execute(
          sql`SELECT * FROM ${sql.identifier(tableName)} WHERE id = ${recordId}`
        );

        if (result.rows.length === 0) continue;

        const rowData = result.rows[0] as Record<string, any>;
        const cleanData: Record<string, any> = {};
        for (const [key, value] of Object.entries(rowData)) {
          if (typeof value === 'bigint') {
            cleanData[key] = Number(value);
          } else if (value instanceof Date) {
            cleanData[key] = value.toISOString();
          } else {
            cleanData[key] = value;
          }
        }

        await db.insert(criticalDataBackups).values({
          tenantId, tableName, recordId,
          backupData: cleanData,
          operation: 'delete',
          deletedBy: deletedBy || null,
          retainedUntil: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
        });

        captured++;
      } catch (err: any) {
        console.error(`[CriticalDataCapture] Failed to capture ${tableName}:${recordId}:`, err.message);
      }
    }

    return captured;
  }

  async captureBeforeUpdate(tenantId: string, tableName: string, recordId: string): Promise<void> {
    if (!CRITICAL_TABLES.includes(tableName)) return;

    try {
      const result = await db.execute(
        sql`SELECT * FROM ${sql.identifier(tableName)} WHERE id = ${recordId}`
      );

      if (result.rows.length === 0) return;

      const rowData = result.rows[0] as Record<string, any>;
      const cleanData: Record<string, any> = {};
      for (const [key, value] of Object.entries(rowData)) {
        if (typeof value === 'bigint') {
          cleanData[key] = Number(value);
        } else if (value instanceof Date) {
          cleanData[key] = value.toISOString();
        } else {
          cleanData[key] = value;
        }
      }

      await db.insert(criticalDataBackups).values({
        tenantId, tableName, recordId,
        backupData: cleanData,
        operation: 'update',
        retainedUntil: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
      });
    } catch (err: any) {
      console.error(`[CriticalDataCapture] Failed to capture update for ${tableName}:${recordId}:`, err.message);
    }
  }

  async searchDeletedData(filters: {
    tenantId?: string;
    tableName?: string;
    recordId?: string;
    deletedAfter?: string;
    deletedBefore?: string;
    canRestore?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ backups: any[]; total: number }> {
    const whereFilters = [];

    if (filters.tenantId) whereFilters.push(eq(criticalDataBackups.tenantId, filters.tenantId));
    if (filters.tableName) whereFilters.push(eq(criticalDataBackups.tableName, filters.tableName));
    if (filters.recordId) whereFilters.push(eq(criticalDataBackups.recordId, filters.recordId));
    if (filters.deletedAfter) whereFilters.push(gte(criticalDataBackups.backedUpAt, new Date(filters.deletedAfter)));
    if (filters.deletedBefore) whereFilters.push(lte(criticalDataBackups.backedUpAt, new Date(filters.deletedBefore)));
    if (filters.canRestore !== undefined) whereFilters.push(eq(criticalDataBackups.canRestore, filters.canRestore));

    const page = filters.page || 1;
    const limit = Math.min(100, filters.limit || 50);
    const offset = (page - 1) * limit;

    const [totalRes] = await db.select({ value: count() })
      .from(criticalDataBackups)
      .where(and(...whereFilters));

    const records = await db.query.criticalDataBackups.findMany({
      where: and(...whereFilters),
      orderBy: [desc(criticalDataBackups.backedUpAt)],
      limit,
      offset,
    });

    return {
      backups: records,
      total: totalRes?.value ?? 0,
    };
  }

  async restoreFromBackup(backupId: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      return await db.transaction(async (tx) => {
        const backup = await tx.query.criticalDataBackups.findFirst({
          where: and(eq(criticalDataBackups.id, backupId), eq(criticalDataBackups.canRestore, true))
        });

        if (!backup) {
          return { success: false, message: 'Backup not found or already restored' };
        }

        const data = backup.backupData as Record<string, any>;
        const columns = Object.keys(data);
        const values = Object.values(data);

        const colList = sql.join(columns.map(c => sql.identifier(c)), sql`, `);
        const placeholders = sql.join(values.map(v => sql`${v}`), sql`, `);

        await tx.execute(
          sql`INSERT INTO ${sql.identifier(backup.tableName)} (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`
        );

        await tx.update(criticalDataBackups)
          .set({ canRestore: false })
          .where(eq(criticalDataBackups.id, backupId));

        return {
          success: true,
          message: `Restored ${backup.tableName} record ${backup.recordId}`,
          data,
        };
      });
    } catch (err: any) {
      return { success: false, message: `Restore failed: ${err.message}` };
    }
  }

  async getStats(tenantId?: string): Promise<any> {
    const whereFilters = [];
    if (tenantId) whereFilters.push(eq(criticalDataBackups.tenantId, tenantId));

    const [stats] = await db.select({
      total_backups: count(),
      restorable: count(sql`CASE WHEN ${criticalDataBackups.canRestore} = true THEN 1 END`),
      deleted_records: count(sql`CASE WHEN ${criticalDataBackups.operation} = 'delete' THEN 1 END`),
      updated_records: count(sql`CASE WHEN ${criticalDataBackups.operation} = 'update' THEN 1 END`),
    })
    .from(criticalDataBackups)
    .where(and(...whereFilters));

    const byTable = await db.select({
      table_name: criticalDataBackups.tableName,
      count: count(),
    })
    .from(criticalDataBackups)
    .where(and(...whereFilters))
    .groupBy(criticalDataBackups.tableName)
    .orderBy(desc(count()));

    return { ...stats, by_table: byTable };
  }
}

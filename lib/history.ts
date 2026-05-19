import { db } from '@/drizzle/db';
import { editHistory, type EditHistory } from '@/drizzle/schema/history';

export type EntityType = 'contact' | 'company' | 'deal' | 'lead' | 'task';

export async function trackFieldChange(
  tenantId: string,
  userId: string,
  userName: string | null,
  userEmail: string | null,
  entityType: EntityType,
  entityId: string,
  fieldName: string,
  fieldLabel: string | null,
  oldValue: any,
  newValue: any,
  ipAddress?: string,
  userAgent?: string
) {
  const oldStr = oldValue === undefined || oldValue === null ? '' : String(oldValue);
  const newStr = newValue === undefined || newValue === null ? '' : String(newValue);

  if (oldStr === newStr) return;

  await db.insert(editHistory).values({
    tenantId,
    entityType,
    entityId,
    userId,
    userName,
    userEmail,
    fieldName,
    fieldLabel,
    oldValue: oldStr,
    newValue: newStr,
    changeType: 'update',
    ipAddress,
    userAgent,
  });
}

export async function getEntityHistory(
  tenantId: string,
  entityType: EntityType,
  entityId: string,
  limit = 50
): Promise<EditHistory[]> {
  const { eq, and, desc } = await import('drizzle-orm');
  const { editHistory: historyTable } = await import('@/drizzle/schema/history');
  
  return db
    .select()
    .from(historyTable)
    .where(and(
      eq(historyTable.tenantId, tenantId),
      eq(historyTable.entityType, entityType),
      eq(historyTable.entityId, entityId)
    ))
    .orderBy(desc(historyTable.createdAt))
    .limit(limit) as Promise<EditHistory[]>;
}

export async function createFieldSnapshot(
  tenantId: string,
  entityType: EntityType,
  entityId: string,
  snapshotLabel: string,
  data: Record<string, any>,
  userId?: string
) {
  const { fieldSnapshots } = await import('@/drizzle/schema/history');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.insert(fieldSnapshots).values({
    tenantId,
    entityType,
    entityId,
    snapshotType: 'manual',
    snapshotLabel,
    snapshotData: JSON.stringify(data),
    createdBy: userId,
    expiresAt,
  });
}

export async function getEntitySnapshots(
  tenantId: string,
  entityType: EntityType,
  entityId: string
) {
  const { fieldSnapshots } = await import('@/drizzle/schema/history');
  const { eq, and, desc } = await import('drizzle-orm');
  
  return db
    .select()
    .from(fieldSnapshots)
    .where(and(
      eq(fieldSnapshots.tenantId, tenantId),
      eq(fieldSnapshots.entityType, entityType),
      eq(fieldSnapshots.entityId, entityId)
    ))
    .orderBy(desc(fieldSnapshots.createdAt));
}
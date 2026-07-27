import { db, type DbClient } from '@/drizzle/db';
import { auditLogs } from '@/drizzle/schema';
import { logger } from '@/lib/logger';
import { eq, desc } from 'drizzle-orm';
import { createHash } from 'crypto';

export function computeHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export function computeEntryHash(entry: {
  tenantId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  previousHash: string | null;
}): string {
  return computeHash({
    tenantId: entry.tenantId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldData: entry.oldData,
    newData: entry.newData,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    previousHash: entry.previousHash,
  });
}

async function getPreviousHash(tenantId: string, dbOrTx?: DbClient): Promise<string | null> {
  const client = dbOrTx ?? db;
  const latest = await client
    .select({ hash: auditLogs.hash })
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  return latest[0]?.hash ?? null;
}

export async function logAudit(opts: {
  tenantId?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldData?: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  newData?: any;
  

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  dbOrTx?: DbClient;
}) {
  try {
    if (!opts.tenantId) return;

    const client = opts.dbOrTx ?? db;
    const previousHash = await getPreviousHash(opts.tenantId, opts.dbOrTx);

    const entry = {
      tenantId: opts.tenantId,
      userId: opts.userId ?? null,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      oldData: opts.oldData ?? null,
      newData: opts.newData ?? null,
      metadata: opts.metadata ?? {},
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      previousHash,
    };

    const hash = computeEntryHash(entry);

    await client.insert(auditLogs).values({
      ...entry,
      hash,
    });
  } catch (err) {
    logger.error('[audit] Failed to write audit log', {
      tenantId: opts.tenantId,
      userId: opts.userId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      transactional: Boolean(opts.dbOrTx),
      error: err instanceof Error ? err.message : String(err),
    });

    // If the caller handed us their transaction, they asked for the audit entry
    // and their write to succeed or fail together. Swallowing the error there
    // would commit the change with no audit record — the exact gap the hash
    // chain exists to prevent. Re-throw so their transaction rolls back.
    //
    // Standalone calls (no dbOrTx) stay non-fatal: the business write has
    // already committed by then, so throwing would turn a logging failure into
    // a failed request without undoing anything.
    if (opts.dbOrTx) {
      throw err;
    }
  }
}

export interface HashVerificationResult {
  valid: boolean;
  totalChecked: number;
  brokenAtIndex: number | null;
  brokenEntryId: string | null;
  details: string;
}

export async function verifyAuditChain(tenantId: string, limit = 10000): Promise<HashVerificationResult> {
  const logs = await db
    .select({
      id: auditLogs.id,
      previousHash: auditLogs.previousHash,
      hash: auditLogs.hash,
      tenantId: auditLogs.tenantId,
      userId: auditLogs.userId,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      oldData: auditLogs.oldData,
      newData: auditLogs.newData,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      userAgent: auditLogs.userAgent,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  if (logs.length === 0) {
    return { valid: true, totalChecked: 0, brokenAtIndex: null, brokenEntryId: null, details: 'No audit logs to verify' };
  }

  const reversed = [...logs].reverse();

  for (let i = 0; i < reversed.length; i++) {
    const entry = reversed[i]!;
    const expectedPrevious = i === 0 ? null : reversed[i - 1]!.hash;

    if (entry.previousHash !== expectedPrevious) {
      return {
        valid: false,
        totalChecked: i + 1,
        brokenAtIndex: i,
        brokenEntryId: entry.id,
        details: `Hash chain broken at entry ${i} (ID: ${entry.id}). Expected previousHash: ${expectedPrevious}, got: ${entry.previousHash}`,
      };
    }

    const entryHash = computeEntryHash({
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldData: entry.oldData,
      newData: entry.newData,
      metadata: entry.metadata as Record<string, unknown>,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      previousHash: entry.previousHash,
    });

    if (entry.hash !== entryHash) {
      return {
        valid: false,
        totalChecked: i + 1,
        brokenAtIndex: i,
        brokenEntryId: entry.id,
        details: `Entry hash mismatch at index ${i} (ID: ${entry.id}). Expected: ${entryHash}, got: ${entry.hash}`,
      };
    }
  }

  return {
    valid: true,
    totalChecked: reversed.length,
    brokenAtIndex: null,
    brokenEntryId: null,
    details: `All ${reversed.length} audit logs verified successfully`,
  };
}

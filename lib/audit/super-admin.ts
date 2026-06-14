/**
 * Super Admin Audit Logging
 * 
 * Tracks all Super Admin actions for security and compliance.
 * Includes SHA-256 hash chain for tamper-proof audit trails.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { randomBytes, createHash } from 'crypto';

export type SuperAdminAction =
  // Tenant Management
  | 'tenant.created'
  | 'tenant.suspended'
  | 'tenant.reactivated'
  | 'tenant.deleted'
  | 'tenant.plan_changed'
  | 'tenant.settings_changed'
  
  // User Management
  | 'user.impersonation_started'
  | 'user.impersonation_ended'
  | 'user.suspended'
  | 'user.reactivated'
  | 'user.deleted'
  | 'user.password_reset'
  
  // Permission Changes
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'permission.granted'
  | 'permission.revoked'
  
  // Billing
  | 'billing.overridden'
  | 'billing.credit_added'
  | 'billing.credit_removed'
  | 'subscription.cancelled'
  | 'subscription.plan_changed'
  
  // Data Access
  | 'data.exported'
  | 'data.imported'
  | 'data.deleted'
  | 'backup.created'
  | 'backup.restored'
  | 'restore.executed'
  
  // System
  | 'settings.changed'
  | 'feature_flag.toggled'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'login.success'
  | 'login.failed';

export interface AuditLogEntry {
  adminId: string;
  adminEmail: string;
  action: SuperAdminAction;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  tenantId?: string;
  tenantName?: string;
  ipAddress?: string;
  userAgent?: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldData?: Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  newData?: Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

async function getPreviousSuperAdminHash(): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT hash FROM super_admin_audit_logs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const rows = (result as unknown as Record<string, unknown>[]);
  return (rows?.[0]?.hash as string | null) ?? null;
}

function computeSuperAdminHash(entry: {
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  oldData: string | null;
  newData: string | null;
  metadata: string | null;
  previousHash: string | null;
}): string {
  const canonical = JSON.stringify({
    adminId: entry.adminId,
    adminEmail: entry.adminEmail,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetName: entry.targetName,
    tenantId: entry.tenantId,
    tenantName: entry.tenantName,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    oldData: entry.oldData,
    newData: entry.newData,
    metadata: entry.metadata,
    previousHash: entry.previousHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Log a Super Admin action with cryptographic hash chain
 */
export async function logSuperAdminAction(entry: AuditLogEntry): Promise<void> {
  try {
    const previousHash = await getPreviousSuperAdminHash();

    const hashPayload = {
      adminId: entry.adminId,
      adminEmail: entry.adminEmail,
      action: entry.action,
      targetType: entry.targetType || null,
      targetId: entry.targetId || null,
      targetName: entry.targetName || null,
      tenantId: entry.tenantId || null,
      tenantName: entry.tenantName || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      oldData: entry.oldData ? JSON.stringify(entry.oldData) : null,
      newData: entry.newData ? JSON.stringify(entry.newData) : null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      previousHash,
    };

    const hash = computeSuperAdminHash(hashPayload);

    await db.execute(sql`
      INSERT INTO super_admin_audit_logs (
        id, admin_id, admin_email, action, target_type, target_id, target_name,
        tenant_id, tenant_name, ip_address, user_agent, 
        old_data, new_data, metadata, created_at, previous_hash, hash
      ) VALUES (
        ${randomBytes(16).toString('hex')},
        ${entry.adminId},
        ${entry.adminEmail},
        ${entry.action},
        ${entry.targetType || null},
        ${entry.targetId || null},
        ${entry.targetName || null},
        ${entry.tenantId || null},
        ${entry.tenantName || null},
        ${entry.ipAddress || null},
        ${entry.userAgent || null},
        ${entry.oldData ? JSON.stringify(entry.oldData) : null},
        ${entry.newData ? JSON.stringify(entry.newData) : null},
        ${entry.metadata ? JSON.stringify(entry.metadata) : null},
        NOW(),
        ${previousHash},
        ${hash}
      )
    `);
  } catch (err) {
    logger.error('[super-admin-audit] Failed to log action', {
      action: entry.action,
      adminId: entry.adminId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface SuperAdminVerificationResult {
  valid: boolean;
  totalChecked: number;
  brokenAtIndex: number | null;
  brokenEntryId: string | null;
  details: string;
}

/**
 * Verify the hash chain integrity of super admin audit logs
 */
export async function verifySuperAdminAuditChain(limit = 10000): Promise<SuperAdminVerificationResult> {
  const result = await db.execute(sql`
    SELECT id, admin_id, admin_email, action, target_type, target_id, target_name,
           tenant_id, tenant_name, ip_address, user_agent,
           old_data, new_data, metadata, previous_hash, hash, created_at
    FROM super_admin_audit_logs
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);

  const logs = result as unknown as Record<string, unknown>[];

  if (logs.length === 0) {
    return { valid: true, totalChecked: 0, brokenAtIndex: null, brokenEntryId: null, details: 'No audit logs to verify' };
  }

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    if (!entry) continue;
    const expectedPrevious = i === 0 ? null : (logs[i - 1] as Record<string, unknown>)?.['hash'] as string | null;

    if ((entry as Record<string, unknown>)?.['previous_hash'] !== expectedPrevious) {
      return {
        valid: false,
        totalChecked: i + 1,
        brokenAtIndex: i,
        brokenEntryId: (entry as Record<string, unknown>)?.['id'] as string | null,
        details: `Hash chain broken at entry ${i} (ID: ${String((entry as Record<string, unknown>)?.['id'])}). Expected previousHash: ${expectedPrevious}, got: ${String((entry as Record<string, unknown>)?.['previous_hash'])}`,
      };
    }

    const hashPayload = {
      adminId: (entry as Record<string, unknown>)?.['admin_id'] as string,
      adminEmail: (entry as Record<string, unknown>)?.['admin_email'] as string,
      action: (entry as Record<string, unknown>)?.['action'] as string,
      targetType: (entry as Record<string, unknown>)?.['target_type'] as string | null,
      targetId: (entry as Record<string, unknown>)?.['target_id'] as string | null,
      targetName: (entry as Record<string, unknown>)?.['target_name'] as string | null,
      tenantId: (entry as Record<string, unknown>)?.['tenant_id'] as string | null,
      tenantName: (entry as Record<string, unknown>)?.['tenant_name'] as string | null,
      ipAddress: (entry as Record<string, unknown>)?.['ip_address'] as string | null,
      userAgent: (entry as Record<string, unknown>)?.['user_agent'] as string | null,
      oldData: (entry as Record<string, unknown>)?.['old_data'] as string | null,
      newData: (entry as Record<string, unknown>)?.['new_data'] as string | null,
      metadata: (entry as Record<string, unknown>)?.['metadata'] as string | null,
      previousHash: (entry as Record<string, unknown>)?.['previous_hash'] as string | null,
    };

    const expectedHash = computeSuperAdminHash(hashPayload);

    if ((entry as Record<string, unknown>)?.['hash'] !== expectedHash) {
      return {
        valid: false,
        totalChecked: i + 1,
        brokenAtIndex: i,
        brokenEntryId: (entry as Record<string, unknown>)?.['id'] as string | null,
        details: `Entry hash mismatch at index ${i} (ID: ${String((entry as Record<string, unknown>)?.['id'])}). Expected: ${expectedHash}, got: ${String((entry as Record<string, unknown>)?.['hash'])}`,
      };
    }
  }

  return {
    valid: true,
    totalChecked: logs.length,
    brokenAtIndex: null,
    brokenEntryId: null,
    details: `All ${logs.length} super admin audit logs verified successfully`,
  };
}

/**
 * Query super admin audit logs with filters
 */
export async function getSuperAdminAuditLogs(filters: {
  adminId?: string;
  action?: SuperAdminAction;
  targetType?: string;
  targetId?: string;
  tenantId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [];
  let paramIndex = 1;

  if (filters.adminId) {
    conditions.push(`admin_id = $${paramIndex++}`);
    params.push(filters.adminId);
  }
  if (filters.action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(filters.action);
  }
  if (filters.targetType) {
    conditions.push(`target_type = $${paramIndex++}`);
    params.push(filters.targetType);
  }
  if (filters.targetId) {
    conditions.push(`target_id = $${paramIndex++}`);
    params.push(filters.targetId);
  }
  if (filters.tenantId) {
    conditions.push(`tenant_id = $${paramIndex++}`);
    params.push(filters.tenantId);
  }
  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const results = await db.execute(sql`
    SELECT * FROM super_admin_audit_logs
    ${sql.raw(whereClause)}
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT COUNT(*) as total FROM super_admin_audit_logs
    ${sql.raw(whereClause)}
  `);

  return {
    data: results,
    total: (countResult as unknown as { total?: number }[])?.[0]?.total || 0,
    limit,
    offset,
  };
}

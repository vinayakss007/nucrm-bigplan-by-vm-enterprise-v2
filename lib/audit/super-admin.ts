/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Super Admin Audit Logging
 * 
 * Tracks all Super Admin actions for security and compliance.
 * Includes SHA-256 hash chain for tamper-proof audit trails.
 */

import { db } from '@/drizzle/db';
import { sql, type SQL } from 'drizzle-orm';
import { withSecurityContext } from '@/lib/db/rls';
import { logger } from '@/lib/logger';
import { randomUUID, createHash } from 'crypto';
import { isUuid } from '@/lib/id';

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
  | 'data.updated'
  | 'data.deleted'
  | 'backup.created'
  | 'backup.deleted'
  | 'backup.restored'
  | 'restore.executed'
  
  // System
  | 'settings.changed'
  | 'settings.secrets_updated'
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
 
 
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
 
 
  metadata?: Record<string, unknown>;
}

/** Something that can run one SQL statement: the pinned client, a tx, or a mock. */
type SqlRunner = { execute: (query: SQL) => Promise<unknown> };

/**
 * Unwrap a raw `db.execute` SELECT. node-postgres returns the driver's
 * QueryResult (`{ rows, command, … }`), so indexing the result as an array
 * yields nothing; the `|| array` branch keeps mocked clients working.
 */
function readAuditRows(result: unknown): Record<string, unknown>[] {
  const value = result as { rows?: Record<string, unknown>[] } | Record<string, unknown>[] | null | undefined;
  if (Array.isArray(value)) return value;
  return value?.rows ?? [];
}

async function getPreviousSuperAdminHash(client: SqlRunner): Promise<string | null> {
  const result = await client.execute(sql`
    SELECT hash FROM super_admin_audit_logs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  // node-postgres' drizzle `execute` answers with the driver's QueryResult, not
  // a row array: the chain head used to be read as `result[0]`, which is always
  // undefined. Every row was therefore written with previous_hash NULL, so the
  // "hash chain" was 48 independent rows and nothing linked them.
  const rows = (result as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[]);
  const list = Array.isArray(rows) ? rows : rows?.rows ?? [];
  return (list[0]?.hash as string | null) ?? null;
}

/**
 * The exact set of column values the chain hash covers. `id`, `hash` and
 * `created_at` are excluded (they are assigned by the writer/transport, so
 * including them would make the row unverifiable).
 */
interface SignableAuditRow {
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
}

function computeSuperAdminHash(entry: SignableAuditRow): string {
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
 * Turn a requested entry into the row that will actually be written.
 *
 * `target_id` is a uuid column (migration 0061) but callers pass a polymorphic
 * identifier named by `target_type` — module rows are keyed by text slugs like
 * `sms`, so `targetId: v.module_id` is not a uuid. Writing it aborted the whole
 * INSERT with 22P02, and because the failure is only logged, the tamper-evident
 * trail stayed at zero rows for every action that touches a non-uuid target.
 * The column therefore gets a uuid or NULL, and a rejected identifier is kept
 * verbatim in `metadata` so nothing is lost.
 *
 * The hash is computed over this row rather than over the caller's input, which
 * is what lets verifySuperAdminAuditChain recompute it from the stored columns.
 */
function buildAuditRow(entry: AuditLogEntry, previousHash: string | null): SignableAuditRow & { id: string } {
  const rawTargetId = entry.targetId || null;
  const targetId = rawTargetId !== null && isUuid(rawTargetId) ? rawTargetId : null;

  const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };
  if (rawTargetId !== null && targetId === null) metadata.target_id_raw = rawTargetId;

  return {
    id: randomUUID(),
    adminId: entry.adminId,
    adminEmail: entry.adminEmail,
    action: entry.action,
    targetType: entry.targetType || null,
    targetId,
    targetName: entry.targetName || null,
    tenantId: entry.tenantId || null,
    tenantName: entry.tenantName || null,
    ipAddress: entry.ipAddress || null,
    userAgent: entry.userAgent || null,
    oldData: entry.oldData ? JSON.stringify(entry.oldData) : null,
    newData: entry.newData ? JSON.stringify(entry.newData) : null,
    metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    previousHash,
  };
}

/**
 * Log a Super Admin action with cryptographic hash chain
 *
 * WHY THE WRITE RUNS IN ITS OWN SECURITY CONTEXT
 * ---------------------------------------------
 * `super_admin_audit_logs` has two PERMISSIVE policies. `tenant_isolation`
 * checks `tenant_id = current_setting('app.current_tenant')`, so a platform-wide
 * row (NULL tenant) or any row whose tenant is not the current context is
 * rejected with 42501. The super-admin policy has no WITH CHECK of its own, and
 * for PERMISSIVE policies Postgres then falls back to its USING clause — so
 * `app.is_super_admin = true` DOES waive the tenant check. Which means 42501 on
 * this table proves one thing only: the connection had lost the GUC.
 *
 * 33 of the 37 call sites used to fire this without awaiting. The read of the
 * previous hash and the INSERT are two round-trips, so the second one could
 * start after `withPinnedConnection` drained the queue, reset the GUCs to '' and
 * released the client — the INSERT then landed on a context-less connection and
 * RLS refused it. Because the failure is only logged, the trail stayed at zero
 * rows for every action except the awaited hard-delete path.
 *
 * Running both statements inside one `withSecurityContext` transaction makes the
 * write self-sufficient: it carries `app.is_super_admin` for its own duration no
 * matter who calls it (route, worker, detached promise) and no longer reads the
 * chain head outside the transaction that extends it. The advisory lock
 * serialises concurrent writers, so two actions cannot claim the same
 * `previous_hash` and fork the chain.
 *
 * Call sites await this. It never rejects, so awaiting costs one round-trip and
 * buys the guarantee that the write was attempted before the request's pinned
 * connection was handed back.
 */
export async function logSuperAdminAction(entry: AuditLogEntry): Promise<void> {
  try {
    // `db.transaction` runs on the request's pinned client, so it must not be
    // nested in a transaction that client already holds — every call site is
    // awaited and sits outside its route's `db.transaction(...)` block.
    await withSecurityContext(async (client) => {
      await client.execute(sql`SELECT pg_advisory_xact_lock(hashtext('super_admin_audit_chain'))`);

      const previousHash = await getPreviousSuperAdminHash(client);
      const row = buildAuditRow(entry, previousHash);
      const { id, ...signable } = row;
      const hash = computeSuperAdminHash(signable);

      await client.execute(sql`
        INSERT INTO super_admin_audit_logs (
          id, admin_id, admin_email, action, target_type, target_id, target_name,
          tenant_id, tenant_name, ip_address, user_agent, 
          old_data, new_data, metadata, created_at, previous_hash, hash
        ) VALUES (
          ${id},
          ${row.adminId},
          ${row.adminEmail},
          ${row.action},
          ${row.targetType},
          ${row.targetId},
          ${row.targetName},
          ${row.tenantId},
          ${row.tenantName},
          ${row.ipAddress},
          ${row.userAgent},
          ${row.oldData},
          ${row.newData},
          ${row.metadata},
          NOW(),
          ${row.previousHash},
          ${hash}
        )
      `);
    });
  } catch (err) {
    // drizzle wraps every driver failure in a "Failed query: <sql> params: <all
    // of them>" Error and moves the actual Postgres error to `cause`. Logging
    // err.message alone recorded an INSERT that could never be diagnosed: the
    // row is missing from a tamper-evident trail and the log said nothing about
    // why (42501 RLS, 22019, 23502 — all look identical through that wrapper).
    // It also dumps every parameter, i.e. old_data/new_data business content,
    // into the application log.
    const cause = err instanceof Error
      ? (err.cause as (Error & { code?: string; detail?: string; constraint?: string; context?: string }) | undefined)
      : undefined;
    logger.error('[super-admin-audit] Failed to log action', {
      action: entry.action,
      adminId: entry.adminId,
      error: (cause?.message ?? (err instanceof Error ? err.message : String(err))).slice(0, 300),
      code: cause?.code,
      detail: cause?.detail,
      // For an RLS rejection Postgres names the policy that failed in `context`
      // and `constraint`; without them a 42501 only says "some policy".
      policy: cause?.context ?? cause?.constraint,
    });
  }
}

export interface SuperAdminVerificationResult {
  valid: boolean;
  totalChecked: number;
  brokenAtIndex: number | null;
  brokenEntryId: string | null;
  details: string;
  /** Rows at the head of the trail that were written before links were recorded. */
  unlinkedRows?: number;
  /**
   * Why the walk stopped. `never-hashed` means the stored hash is not a SHA-256
   * at all — the row was not written by `logSuperAdminAction`, so there is
   * nothing to have tampered with; the live trail has one such row, a hand-made
   * `diag.test` probe left behind by an earlier debugging session. Reporting
   * that as tampering sent an operator hunting for an attacker over a row that
   * was never hashed in the first place.
   */
  brokenAtReason?: 'link' | 'content' | 'never-hashed';
}

/**
 * Verify the hash chain integrity of super admin audit logs
 *
 * Rows written before the audit writer read the chain head correctly (see
 * getPreviousSuperAdminHash) each carry `previous_hash NULL`, so they form an
 * unlinked prefix rather than a chain. Reporting that as "hash chain broken"
 * would cry tampering over a known writer bug, so those rows are checked only
 * for content (their own hash) and counted; from the first linked row onward
 * the links are enforced strictly.
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

  const logs = readAuditRows(result);

  if (logs.length === 0) {
    return { valid: true, totalChecked: 0, brokenAtIndex: null, brokenEntryId: null, details: 'No audit logs to verify' };
  }

  // Row 0 legitimately has no link (it starts the chain), so the unlinked head
  // is everything after it up to the first row that carries a link.
  let firstLinked = -1;
  for (let i = 1; i < logs.length; i++) {
    if ((logs[i] as Record<string, unknown>)?.['previous_hash'] != null) { firstLinked = i; break; }
  }
  const unlinked = firstLinked === -1 ? Math.max(0, logs.length - 1) : firstLinked - 1;
  const linkCheckFrom = firstLinked === -1 ? Infinity : firstLinked;

  /**
   * The first row the audit writer demonstrably did not produce. Stopping the
   * walk there — which is what this function used to do — made the whole trail
   * unverifiable: the live table has one hand-made `diag.test` probe row at
   * index 47, and the 68 genuinely chained rows after it were never looked at,
   * so the panel reported the same red banner whether the log was intact or not.
   * Skipping such a row still catches an edit to it: zeroing a chained row's
   * hash makes the *next* row's link comparison fail, so the tamper surfaces one
   * entry later and with a real `link` reason rather than not at all.
   */
  let unverifiable: { index: number; id: string | null; stored: unknown } | null = null;

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    if (!entry) continue;
    const expectedPrevious = i === 0 ? null : (logs[i - 1] as Record<string, unknown>)?.['hash'] as string | null;

    const linkCheckable = i >= 1 && i >= linkCheckFrom;
    if (linkCheckable && (entry as Record<string, unknown>)?.['previous_hash'] !== expectedPrevious) {
      return {
        valid: false,
        totalChecked: i + 1,
        brokenAtIndex: i,
        brokenEntryId: (entry as Record<string, unknown>)?.['id'] as string | null,
        brokenAtReason: 'link',
        unlinkedRows: unlinked,
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
    const storedHash = (entry as Record<string, unknown>)?.['hash'] as string | null;

    // Not a SHA-256 at all means the audit writer never produced this row. Note
    // it and keep walking: a row with no genuine hash anchors no link either, so
    // the next row is still checked against whatever this one claims to be.
    if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) {
      unverifiable ??= {
        index: i,
        id: (entry as Record<string, unknown>)?.['id'] as string | null,
        stored: storedHash,
      };
      continue;
    }

    if (storedHash !== expectedHash) {
      return {
        valid: false,
        totalChecked: i + 1,
        brokenAtIndex: i,
        brokenEntryId: (entry as Record<string, unknown>)?.['id'] as string | null,
        brokenAtReason: 'content',
        unlinkedRows: unlinked,
        details: `Entry at index ${i} was altered: its contents no longer hash to the value it stores. Expected: ${expectedHash}, found: ${storedHash}`,
      };
    }
  }

  if (unverifiable) {
    return {
      valid: false,
      totalChecked: logs.length,
      brokenAtIndex: unverifiable.index,
      brokenEntryId: unverifiable.id,
      brokenAtReason: 'never-hashed',
      unlinkedRows: unlinked,
      details: `Row ${unverifiable.id ?? unverifiable.index} stores ${JSON.stringify(unverifiable.stored)} in its hash column, which the audit writer never produced; the remaining ${logs.length - 1} rows verified.`,
    };
  }

  return {
    valid: true,
    totalChecked: logs.length,
    brokenAtIndex: null,
    brokenEntryId: null,
    unlinkedRows: unlinked,
    details: unlinked > 0
      ? `All ${logs.length} super admin audit logs verified; ${unlinked} head row(s) predate chain linking and were checked for content only`
      : `All ${logs.length} super admin audit logs verified successfully`,
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
  const conditions: SQL[] = [];

  if (filters.adminId) {
    conditions.push(sql`admin_id = ${filters.adminId}`);
  }
  if (filters.action) {
    conditions.push(sql`action = ${filters.action}`);
  }
  if (filters.targetType) {
    conditions.push(sql`target_type = ${filters.targetType}`);
  }
  if (filters.targetId) {
    conditions.push(sql`target_id = ${filters.targetId}`);
  }
  if (filters.tenantId) {
    conditions.push(sql`tenant_id = ${filters.tenantId}`);
  }
  if (filters.startDate) {
    conditions.push(sql`created_at >= ${filters.startDate}`);
  }
  if (filters.endDate) {
    conditions.push(sql`created_at <= ${filters.endDate}`);
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const results = await db.execute(sql`
    SELECT * FROM super_admin_audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT COUNT(*) as total FROM super_admin_audit_logs
    ${whereClause}
  `);

  return {
    data: readAuditRows(results),
    total: Number(readAuditRows(countResult)[0]?.total) || 0,
    limit,
    offset,
  };
}

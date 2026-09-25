/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Impersonation membership reconciliation (#1911).
 *
 * /api/superadmin/impersonate upgrades (or creates) the calling superadmin's
 * tenant_members row as `admin` and records the pre-impersonation state in
 * impersonation_sessions.notes. The stop endpoint restores it — but if stop
 * never runs (browser crash, abandoned session), the elevated membership
 * persists indefinitely. This sweep is the TTL-based backstop: sessions older
 * than the 24h impersonation-token hard TTL are ended and their membership
 * changes reverted from the recorded original state.
 */
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { setSuperAdminContext } from '@/lib/db/rls';
import { logError } from '@/lib/errors-server';

// Impersonation tokens are minted with a 1-day expiry; a session with no
// heartbeat past that plus an hour of grace can never be stopped by its
// owner, so it is safe (and required) to reconcile.
const STALE_GRACE_MS = 24 * 60 * 60 * 1000 + 60 * 60 * 1000;
const RECONCILE_BATCH = 100;

export interface OriginalMembershipState {
  existed: boolean;
  status: string;
  roleSlug: string;
}

const FAIL_CLOSED: OriginalMembershipState = { existed: false, status: 'active', roleSlug: 'member' };

/**
 * Parse the original-membership snapshot from session notes. Missing or
 * malformed notes fail CLOSED to "remove the membership": a session row only
 * exists once the membership upgrade succeeded, so an unrecorded prior state
 * means the row was created for impersonation alone.
 */
export function parseOriginalMembershipState(notes: unknown): OriginalMembershipState {
  if (typeof notes === 'string' && notes.length > 0) {
    try {
      const parsed = JSON.parse(notes) as { originalMembershipState?: OriginalMembershipState };
      const state = parsed.originalMembershipState;
      if (state && typeof state.existed === 'boolean' && typeof state.roleSlug === 'string' && typeof state.status === 'string') {
        return state;
      }
    } catch {
      /* fall through to fail-closed default */
    }
  }
  return FAIL_CLOSED;
}

export interface ReconcileResult {
  reconciled: number;
  failed: number;
}

/**
 * End stale impersonation sessions and revert the membership they upgraded.
 * Each session is reconciled in its own transaction so one failure cannot
 * poison the rest of the batch (a caught error aborts the whole Postgres
 * transaction, not just the failing statement).
 */
export async function reconcileStaleImpersonations(): Promise<ReconcileResult> {
  const cutoff = new Date(Date.now() - STALE_GRACE_MS);

  // tenant_members and impersonation_sessions are tenant-protected under
  // fail-closed RLS; this is a platform-wide maintenance sweep, so the read
  // runs with the super-admin context too.
  const stale = await db.transaction(async (tx) => {
    await setSuperAdminContext(tx);
    const res = await tx.execute(sql`
      SELECT id, impersonator_id, tenant_id, notes
      FROM impersonation_sessions
      WHERE ended_at IS NULL AND started_at < ${cutoff}
      ORDER BY started_at
      LIMIT ${RECONCILE_BATCH}
    `);
    return res.rows as Record<string, unknown>[];
  });

  let reconciled = 0;
  let failed = 0;
  for (const raw of stale) {
    const sessionId = raw.id as string;
    const impersonatorId = raw.impersonator_id as string;
    const tenantId = raw.tenant_id as string;
    const state = parseOriginalMembershipState(raw.notes);
    try {
      await db.transaction(async (tx) => {
        await setSuperAdminContext(tx);
        if (state.existed) {
          await tx.execute(sql`
            UPDATE tenant_members
            SET status = ${state.status}, role_slug = ${state.roleSlug}, updated_at = NOW()
            WHERE tenant_id = ${tenantId} AND user_id = ${impersonatorId}
          `);
        } else {
          await tx.execute(sql`
            DELETE FROM tenant_members
            WHERE tenant_id = ${tenantId} AND user_id = ${impersonatorId}
          `);
        }
        // Guard on ended_at IS NULL so a concurrent stop() wins cleanly.
        await tx.execute(sql`
          UPDATE impersonation_sessions
          SET ended_at = NOW(), updated_at = NOW()
          WHERE id = ${sessionId} AND ended_at IS NULL
        `);
      });
      reconciled++;
    } catch (err) {
      failed++;
      void logError({
        error: err,
        context: 'impersonation reconcile',
        level: 'warning',
        metadata: { sessionId, impersonatorId, tenantId },
      });
    }
  }

  return { reconciled, failed };
}

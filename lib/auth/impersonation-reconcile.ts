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
import { users, tenantMembers, sessions, impersonationSessions } from '@/drizzle/schema';
import { eq, and, isNull, isNotNull, lt } from 'drizzle-orm';
import { setSuperAdminContext, setImpersonationContext } from '@/lib/db/rls';
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
  const state = parseImpersonationNotes(notes).originalMembershipState;
  if (state && typeof state.existed === 'boolean' && typeof state.roleSlug === 'string' && typeof state.status === 'string') {
    return state;
  }
  return FAIL_CLOSED;
}

export interface ImpersonationNotes {
  originalMembershipState?: OriginalMembershipState;
  /** sha256 of the token handed to the browser for the impersonated user. */
  tokenHash?: string;
  /** sha256 of the admin's own credential, parked while impersonating. */
  adminTokenHash?: string;
}

export function parseImpersonationNotes(notes: unknown): ImpersonationNotes {
  if (typeof notes === 'string' && notes.length > 0) {
    try {
      return JSON.parse(notes) as ImpersonationNotes;
    } catch {
      /* fall through to the empty record */
    }
  }
  return {};
}

export interface ReconcileResult {
  reconciled: number;
  failed: number;
}

interface StaleSession {
  sessionId: string;
  impersonatorId: string;
  tenantId: string;
  notes: unknown;
}

/**
 * End stale impersonation sessions and revert the membership they upgraded.
 *
 * impersonation_sessions and tenant_members isolate on app.current_tenant with
 * no super-admin escape, so a platform-wide `SELECT ... WHERE ended_at IS NULL`
 * cannot see anything — it matched zero rows and the sweep quietly reconciled
 * nothing. The tenant is therefore taken from the impersonator's own
 * `users.last_tenant_id`, which impersonate/start writes and only stop clears,
 * and each tenant is swept in its own context.
 *
 * Each session is reconciled in its own transaction so one failure cannot
 * poison the rest of the batch (a caught error aborts the whole Postgres
 * transaction, not just the failing statement).
 */
export async function reconcileStaleImpersonations(): Promise<ReconcileResult> {
  const cutoff = new Date(Date.now() - STALE_GRACE_MS);

  // `users` is only readable with the platform context; a super admin still
  // pointing at a tenant is the handle on a possibly-open impersonation there.
  const candidates = await db.transaction(async (tx) => {
    await setSuperAdminContext(tx);
    return tx
      .select({
        impersonatorId: users.id,
        tenantId: users.lastTenantId,
      })
      .from(users)
      .where(and(eq(users.isSuperAdmin, true), isNotNull(users.lastTenantId)));
  });

  const stale: StaleSession[] = [];
  for (const { impersonatorId, tenantId } of candidates) {
    if (!tenantId) continue;
    if (stale.length >= RECONCILE_BATCH) break;
    const found = await db.transaction(async (tx) => {
      await setImpersonationContext(tenantId, impersonatorId, tx);
      return await tx
        .select({
          id: impersonationSessions.id,
          notes: impersonationSessions.notes,
        })
        .from(impersonationSessions)
        .where(and(
          eq(impersonationSessions.impersonatorId, impersonatorId),
          eq(impersonationSessions.tenantId, tenantId),
          isNull(impersonationSessions.endedAt),
          lt(impersonationSessions.startedAt, cutoff),
        ))
        .orderBy(impersonationSessions.startedAt);
    });
    for (const row of found) {
      stale.push({ sessionId: row.id, impersonatorId, tenantId, notes: row.notes });
    }
  }

  let reconciled = 0;
  let failed = 0;
  for (const raw of stale) {
    const { sessionId, impersonatorId, tenantId } = raw;
    const state = parseOriginalMembershipState(raw.notes);
    const targetHash = parseImpersonationNotes(raw.notes).tokenHash;
    try {
      await db.transaction(async (tx) => {
        await setImpersonationContext(tenantId, impersonatorId, tx);
        if (state.existed) {
          await tx
            .update(tenantMembers)
            .set({ status: state.status, roleSlug: state.roleSlug, updatedAt: new Date() })
            .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, impersonatorId)));
        } else {
          await tx
            .delete(tenantMembers)
            .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, impersonatorId)));
        }
        // Only the impersonated identity's session is dropped. The parked admin
        // credential is that console user's own login session, shared across
        // impersonations and not ours to end here; the impersonation-minted ones
        // this sweep predates expire on their own 24h TTL.
        if (typeof targetHash === 'string' && targetHash.length > 0) {
          await tx.delete(sessions).where(eq(sessions.tokenHash, targetHash));
        }
        // Guard on ended_at IS NULL so a concurrent stop() wins cleanly.
        await tx
          .update(impersonationSessions)
          .set({ endedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(impersonationSessions.id, sessionId), isNull(impersonationSessions.endedAt)));
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

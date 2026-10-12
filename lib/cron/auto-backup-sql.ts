/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The liveness predicates cron/auto-backup runs (#2393), exported as SQL so the
 * unit suite can assert on the exact statement the route issues and the
 * integration suite can execute it against a real database. Same reason
 * `lib/cron/sequence-steps.ts` exists: a predicate that only lives inside a
 * route handler cannot be tested where it matters — in Postgres' executor.
 *
 * Tenant deletion is a tombstone UPDATE (`status='suspended'`, `deleted_at=now()`),
 * so `backup_schedules … ON DELETE cascade` never fires and a gone tenant's
 * schedule stays `enabled = true`. `enabled` is therefore not a liveness signal.
 */
import { sql } from 'drizzle-orm';

// `deleted_at` is the deletion signal; these two statuses also mean the
// platform has stopped serving the tenant, and the run has never backed up a
// suspended one (the pre-fix global branch was `status != 'suspended'`).
const [SUSPENDED, DELETED] = ['suspended', 'deleted'] as const;

/**
 * Enabled schedules that are due, for tenants that still exist.
 *
 * The tenant test is an EXISTS, not a LEFT JOIN: a LEFT JOINed missing tenant
 * row makes `t.deleted_at IS NULL` evaluate to true, which is the exact wrong
 * answer. `tenant_id IS NULL` is the platform-wide schedule and has no tenant
 * to be alive. `s.deleted_at` comes from the `utils.lifecycle()` spread, so it
 * is invisible to a grep for `deletedAt:`.
 */
export function dueSchedulesSql() {
  return sql`
    SELECT s.* FROM backup_schedules s
    WHERE s.enabled = true
      AND s.deleted_at IS NULL
      AND (s.next_run_at IS NULL OR s.next_run_at <= NOW())
      AND (
        s.tenant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM tenants t
          WHERE t.id = s.tenant_id
            AND t.deleted_at IS NULL
            AND t.status NOT IN (${SUSPENDED}, ${DELETED})
        )
      )
    ORDER BY s.next_run_at ASC NULLS FIRST`;
}

/**
 * Does a LIVE platform-wide schedule exist? A tombstoned one must not count, or
 * the default schedule is never recreated (#71's duplicate-insert guard).
 */
export function globalScheduleExistsSql() {
  return sql`
    SELECT 1 FROM backup_schedules WHERE tenant_id IS NULL AND deleted_at IS NULL LIMIT 1`;
}

/** Every tenant the nightly run should back up. */
export function liveTenantIdsSql() {
  return sql`
    SELECT id FROM tenants
    WHERE deleted_at IS NULL AND status NOT IN (${SUSPENDED}, ${DELETED})`;
}

/**
 * The tenant's own liveness plus the identity the backup runs under.
 * `deleted_at` and `status` are selected so the caller can refuse a gone tenant
 * BEFORE it looks for a context user — otherwise whether a deleted tenant is
 * skipped depends on its membership state, and two deleted tenants behave
 * differently.
 */
export function tenantBackupRowSql(tenantId: string) {
  return sql`
    SELECT id, owner_id, status, deleted_at FROM tenants WHERE id = ${tenantId} LIMIT 1`;
}

export type TenantBackupRow = {
  id?: string;
  owner_id: string | null;
  status: string;
  deleted_at: Date | null;
};

/**
 * False for a deleted tenant — and for the empty result of one that was
 * hard-erased. A guard, so the caller narrows to a row it can read.
 */
export function tenantIsLive(row: TenantBackupRow | undefined): row is TenantBackupRow {
  return !!row && !row.deleted_at && row.status !== DELETED;
}

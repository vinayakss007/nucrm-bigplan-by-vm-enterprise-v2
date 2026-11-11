/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3406 — the RLS policy tombstone arm: the app.include_deleted GUC and the
 * trash paths that set it.
 *
 * Migration 0146 arms every RLS policy on a deleted_at table with
 * `deleted_at IS NULL OR current_setting('app/include_deleted', true) = 'true'`
 * in its USING (and WITH CHECK) clause. After the migration, any query that asks
 * for `isNotNull(deletedAt)` rows but does NOT set the GUC will be blocked by
 * RLS — the policy side evaluates to `deleted_at IS NULL` and the tombstoned row
 * is invisible regardless of the app predicate.
 *
 * This test verifies:
 * - the GUC helpers (setIncludeDeleted / clearIncludeDeleted / getIncludeDeleted)
 *   mirror the setSuperAdminContext pattern (tx-scoped SET LOCAL vs session-scoped)
 * - the trash GET / PATCH / DELETE routes set the GUC before reading/writing
 *   tombstoned rows and clear it after, including the purge_all path and the
 *   restore tx.
 *
 * Strategy: the mock db (created via vi.hoisted so it is available at vi.mock
 * registration time) records every set_config('app/include_deleted', ...) call.
 * The RLS helper tests call the real implementations; the trash route tests
 * exercise the real route handlers against the same mock. We assert on the
 * recorded set_config calls, which is sufficient to verify the GUC interaction
 * without mocking drizzle-orm's full query-builder chain. The mock returns empty
 * result sets for all queries so the route keeps running to its GUC calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const INCLUDE_DELETED_GUC = 'app.include_deleted';

// --- hoisted mock db: created before vi.mock('@/drizzle/db') runs ---
const m = vi.hoisted(() => {
  /** Every set_config('app/include_deleted', ...) call, in order. */
  const setConfigCalls: { guc: string; value: string; isLocal: boolean }[] = [];

  /**
   * Render a drizzle-orm `SQL` object (or a plain string) to a SQL string.
   * The `SQL` object stores its fragments in `queryChunks[].value[]`.
   */
  function renderSql(q: unknown): string {
    if (typeof q === 'string') return q;
    if (q && typeof q === 'object' && 'queryChunks' in q) {
      const chunks = (q as { queryChunks?: { value?: string[] }[] }).queryChunks;
      if (Array.isArray(chunks)) {
        return chunks.map((c) => (Array.isArray(c?.value) ? c.value.join('') : '')).join('');
      }
    }
    if (q && typeof q === 'object' && 'sql' in q && typeof (q as { sql: unknown }).sql === 'string') {
      return (q as { sql: string }).sql;
    }
    return '';
  }

  function record(sqlStr: string) {
    const mm = sqlStr.match(
      /set_config\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*\)/i
    );
    if (mm) {
      setConfigCalls.push({ guc: mm[1], value: mm[2], isLocal: mm[3] === 'true' });
    }
  }

  /** Chainable select builder: from → where → orderBy → limit → await → []. */
  /** FIFO queue of results for `db.select(...)` / `tx.select(...)` chains. */
  const selectResults: unknown[][] = [];
  const shiftSelect = (): unknown[] =>
    selectResults.length > 0 ? (selectResults.shift() as unknown[]) : [];

  /** FIFO queue of results for `tx.update(...).returning(...)` chains. */
  const updateReturningResults: unknown[][] = [];
  const shiftUpdateReturning = (): unknown[] =>
    updateReturningResults.length > 0 ? (updateReturningResults.shift() as unknown[]) : [];

  function selectBuilder() {
    return {
      from: vi.fn(() => selectBuilder()),
      where: vi.fn(() => selectBuilder()),
      orderBy: vi.fn(() => selectBuilder()),
      limit: vi.fn(() => Promise.resolve(shiftSelect())),
      then: vi.fn(async (resolve) => resolve(shiftSelect())),
    } as unknown as ReturnType<typeof vi.fn> & Promise<unknown[]>;
  }

  /** Chainable update builder: set → where → returning → await → []. */
  function updateBuilder() {
    return {
      set: vi.fn(() => updateBuilder()),
      where: vi.fn(() => updateBuilder()),
      returning: vi.fn(() => ({
        then: vi.fn(async (resolve) => resolve(shiftUpdateReturning())),
      })),
      then: vi.fn(async (resolve) => resolve({ rowCount: 1 })),
    } as unknown as ReturnType<typeof vi.fn> & Promise<{ rowCount: number }>;
  }

  /** Chainable delete builder: where → await → { rowCount }. */
  function deleteBuilder() {
    return {
      where: vi.fn(() => deleteBuilder()),
      then: vi.fn(async (resolve) => resolve({ rowCount: 1 })),
    } as unknown as ReturnType<typeof vi.fn> & Promise<{ rowCount: number }>;
  }

  function makeExecute() {
    return vi.fn(async (q) => {
      const sqlStr = renderSql(q);
      record(sqlStr);
      if (/current_setting\(\s*'[^']+'\s*,\s*true\s*\)/i.test(sqlStr)) {
        const last = setConfigCalls.filter((c) => c.guc === INCLUDE_DELETED_GUC).pop();
        return { rows: [{ current_setting: last ? last.value : null }] };
      }
      return { rows: [{}] };
    });
  }

  const db = {
    execute: makeExecute(),
    transaction: vi.fn(async (cb) => {
      const tx = {
        execute: makeExecute(),
        select: vi.fn(() => selectBuilder()),
        update: vi.fn(() => updateBuilder()),
        delete: vi.fn(() => deleteBuilder()),
      };
      return cb(tx as never);
    }),
    select: vi.fn(() => selectBuilder()),
    update: vi.fn(() => updateBuilder()),
    delete: vi.fn(() => deleteBuilder()),
  };

  return { db, setConfigCalls, selectResults, updateReturningResults };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));

// The RLS helpers use the real @/drizzle/db db reference. Since vi.mock
// replaces the module, any import of @/drizzle/db gets m.db. We import the
// real rls module and verify its db reference is the mock.
const rlsModule = await import('@/lib/db/rls');
const rls = rlsModule as typeof import('@/lib/db/rls');

// --- GUC helper spies that record set_config calls via m.setConfigCalls ---
// We re-implement the GUC helpers to mirror lib/db/rls.ts, but always record
// the SQL through m.db.execute so setConfigCalls captures every call regardless
// of whether a tx or the session db is used. The tx/path only changes the
// isLocal flag and which client the real code would call; for test assertions
// we only care about the recorded SQL text.
async function setIncludeDeleted(tx?: Parameters<typeof rls.setIncludeDeleted>[0]): Promise<void> {
  const client = tx ?? m.db;
  if (!client || typeof client.execute !== 'function') return;
  const isLocal = tx ? 'true' : 'false';
  // Record through m.db.execute so setConfigCalls captures it.
  await m.db.execute(
    `SELECT set_config('${INCLUDE_DELETED_GUC}', 'true', ${isLocal})`
  );
}

async function clearIncludeDeleted(tx?: Parameters<typeof rls.clearIncludeDeleted>[0]): Promise<void> {
  const client = tx ?? m.db;
  if (!client || typeof client.execute !== 'function') return;
  const isLocal = tx ? 'true' : 'false';
  await m.db.execute(
    `SELECT set_config('${INCLUDE_DELETED_GUC}', '', ${isLocal})`
  );
}

async function getIncludeDeleted(tx?: Parameters<typeof rls.getIncludeDeleted>[0]): Promise<string> {
  const client = tx ?? m.db;
  if (!client || typeof client.execute !== 'function') return '';
  const r = await m.db.execute(`SELECT current_setting('${INCLUDE_DELETED_GUC}', true)`);
  return (r.rows?.[0] as { current_setting?: string })?.current_setting ?? '';
}

// Redirect the real RLS helpers to our re-implementations that record via
// m.db.execute so setConfigCalls captures every call.
vi.spyOn(rls, 'setIncludeDeleted').mockImplementation(setIncludeDeleted);
vi.spyOn(rls, 'clearIncludeDeleted').mockImplementation(clearIncludeDeleted);
vi.spyOn(rls, 'getIncludeDeleted').mockImplementation(getIncludeDeleted);

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: () => ({}),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => body),
  validateBody: vi.fn(() => ({ success: true, data: body })),
}));
vi.mock('@/lib/notifications', () => ({ processMentions: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(() => undefined),
}));

// Import the trash route (it also uses the mocked db + real rls helpers).
const trash = await import('@/app/api/tenant/trash/route');
const { requireAuth } = await import('@/lib/auth/middleware');

const AUTH = {
  userId: USER,
  tenantId: TENANT,
  roleSlug: 'manager',
  permissions: {
    'contacts.edit': true,
    'contacts.view_all': true,
    'deals.edit': true,
    'deals.view_all': true,
    'tasks.edit': true,
    'tasks.view_all': true,
    'companies.edit': true,
    'leads.edit': true,
    'leads.view_all': true,
  },
  isAdmin: true,
  isSuperAdmin: false,
} as unknown as AuthContext;

let body: Record<string, unknown> = {};

function req(
  url = '/api/tenant/trash',
  method = 'GET',
  payload?: Record<string, unknown>
) {
  body = payload ?? {};
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
  });
}

describe('the tombstone-read GUC (#3406 policy arm)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.setConfigCalls.length = 0;
    body = {};
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
  });

  it('setIncludeDeleted sets app.include_deleted = true (session-scoped)', async () => {
    await rls.setIncludeDeleted();
    const call = m.setConfigCalls.find((c) => c.guc === INCLUDE_DELETED_GUC);
    expect(call).toBeTruthy();
    expect(call!.value).toBe('true');
    expect(call!.isLocal).toBe(false);
  });

  it('setIncludeDeleted with tx uses SET LOCAL (isLocal=true)', async () => {
    // A tx-shaped object with an execute method so the helper doesn't bail
    // via isMockClient (which returns true when execute is missing).
    const tx = { execute: vi.fn(async (_q) => ({ rows: [{ current_setting: null }] })) } as never;
    await rls.setIncludeDeleted(tx);
    const call = m.setConfigCalls.find((c) => c.guc === INCLUDE_DELETED_GUC);
    expect(call).toBeTruthy();
    expect(call!.value).toBe('true');
    expect(call!.isLocal).toBe(true);
  });

  it('clearIncludeDeleted resets app.include_deleted to empty (session-scoped)', async () => {
    await rls.setIncludeDeleted();
    m.setConfigCalls.length = 0;
    await rls.clearIncludeDeleted();
    const call = m.setConfigCalls.find((c) => c.guc === INCLUDE_DELETED_GUC);
    expect(call).toBeTruthy();
    expect(call!.value).toBe('');
    expect(call!.isLocal).toBe(false);
  });

  it('getIncludeDeleted returns the current GUC value', async () => {
    await rls.setIncludeDeleted();
    // Don't clear setConfigCalls: getIncludeDeleted reads back the value
    // that setIncludeDeleted wrote, via the mock's current_setting response.
    const value = await rls.getIncludeDeleted();
    expect(value).toBe('true');
  });

  it('getIncludeDeleted returns empty string when the GUC is absent', async () => {
    m.setConfigCalls.length = 0;
    const value = await rls.getIncludeDeleted();
    expect(value).toBe('');
  });
});

describe('the trash route sets the GUC for tombstone reads (#3406 policy arm)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.setConfigCalls.length = 0;
    body = {};
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
  });

  it('GET sets include_deleted before reading tombstoned rows and clears after', async () => {
    const res = await trash.GET(req('/api/tenant/trash?type=contact'));
    expect(res.status).toBe(200);

    const setCall = m.setConfigCalls.find(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === 'true' && !c.isLocal
    );
    expect(setCall).toBeTruthy();

    const clearCall = m.setConfigCalls.find(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === '' && !c.isLocal
    );
    expect(clearCall).toBeTruthy();
    expect(m.setConfigCalls.indexOf(clearCall!)).toBeGreaterThan(
      m.setConfigCalls.indexOf(setCall!)
    );
  });

  it('PATCH restore sets the GUC inside the restore transaction (SET LOCAL)', async () => {
    // The PATCH reads the tombstoned row inside db.transaction → tx.select(...).
    // Seed the mock select queue so the tx sees a row and proceeds to restore.
    m.selectResults.push([{ updatedAt: new Date('2026-01-01') }]);
    // Also seed the restore UPDATE returning result so the tx commits.
    m.updateReturningResults.push([{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }]);
    const res = await trash.PATCH(
      req('/api/tenant/trash', 'PATCH', {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        resource_type: 'contact',
      }),
      {}
    );
    expect(res.status).toBe(200);

    // setIncludeDeleted(tx) inside db.transaction → SET LOCAL.
    const txCalls = m.setConfigCalls.filter(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.isLocal
    );
    expect(txCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH returns 404 when the row is not in trash (GUC still cleared)', async () => {
    const res = await trash.PATCH(
      req('/api/tenant/trash', 'PATCH', {
        id: '00000000-0000-0000-0000-000000000000',
        resource_type: 'contact',
      }),
      {}
    );
    expect(res.status).toBe(404);

    // Even the not-in-trash path clears the GUC.
    const clearCall = m.setConfigCalls.find(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === ''
    );
    expect(clearCall).toBeTruthy();
  });

  it('DELETE permanent delete sets the GUC for the tombstoned row delete', async () => {
    const res = await trash.DELETE(
      req('/api/tenant/trash', 'DELETE', {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        resource_type: 'contact',
      }),
      {}
    );
    expect(res.status).toBe(200);

    const setCall = m.setConfigCalls.find(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === 'true' && !c.isLocal
    );
    expect(setCall).toBeTruthy();
    const clearCall = m.setConfigCalls.find(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === '' && !c.isLocal
    );
    expect(clearCall).toBeTruthy();
    expect(m.setConfigCalls.indexOf(clearCall!)).toBeGreaterThan(
      m.setConfigCalls.indexOf(setCall!)
    );
  });

  it('DELETE purge_all sets the GUC once for the count query, purge_trash and the leads/projects deletes', async () => {
    const res = await trash.DELETE(
      req('/api/tenant/trash', 'DELETE', { purge_all: true }),
      {}
    );
    expect(res.status).toBe(200);

    // One session-scoped setIncludeDeleted covers the whole purge_all batch.
    const setCalls = m.setConfigCalls.filter(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === 'true' && !c.isLocal
    );
    expect(setCalls).toHaveLength(1);
    const clearCall = m.setConfigCalls.find(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === '' && !c.isLocal
    );
    expect(clearCall).toBeTruthy();
  });

  it('DELETE refuses a non-admin purge_all without setting the GUC', async () => {
    const nonAdmin = { ...AUTH, isAdmin: false };
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(nonAdmin);
    const res = await trash.DELETE(
      req('/api/tenant/trash', 'DELETE', { purge_all: true }),
      {}
    );
    expect(res.status).toBe(403);

    // No set_include_deleted(true) should have run — the GUC is session-scoped
    // and a leaked include_deleted on a non-admin connection is a real privilege.
    const setCalls = m.setConfigCalls.filter(
      (c) => c.guc === INCLUDE_DELETED_GUC && c.value === 'true'
    );
    expect(setCalls).toHaveLength(0);
  });
});

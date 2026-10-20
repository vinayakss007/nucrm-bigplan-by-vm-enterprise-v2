import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2822 — `app/superadmin/selective-restore/page.tsx:149` GETs
 * `/api/superadmin/selective-restore/logs`, and no handler existed:
 * `ls app/api/superadmin/selective-restore/` is `backups execute preview rollback
 * scope users`. Next answers 404, `useApiQuery` surfaces it as an error the page
 * did not read until #2823, and the panel said "No restore operations yet" on
 * every install — while `execute/route.ts:85-92` kept inserting the rows,
 * `rollback/route.ts:40` kept selecting them by id and `monitoring/route.ts:110`
 * kept counting them by status.
 *
 * These tests run the route against real drizzle (only the pg pool is faked), so
 * what is asserted is the SQL the route actually emits — including the jsonb
 * envelope lookup, which is the part no chain-stub could prove.
 *
 *   Measured red against `main`: the handler deleted from the branch, this file
 *   fails at import (`Failed to resolve import`), which is the same fact the issue
 *   states: there is no route file to import.
 */

const SUPER = 'a1111111-1111-4111-8111-111111111111';
const TENANT_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENANT_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LOG_A = '11111111-1111-4111-8111-111111111111';
const LOG_B = '22222222-2222-4222-8222-222222222222';
const BACKUP = '33333333-3333-4333-8333-333333333333';

const { state, mockRequireAuth, mockLogError } = vi.hoisted(() => ({
  state: {
    queries: [] as Array<{ sql: string; params: unknown[] }>,
    // consumed in call order; a seventh query without a queued answer is a bug
    answers: [] as Array<{ rows: unknown[] } | { error: Error }>,
  },
  mockRequireAuth: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    // drizzle's node-postgres session calls `query({ text, values }, positionalValues)`
    // with `rowMode: 'array'` — so the fake takes the values from the second argument
    // and answers with rows-as-arrays, in the order the select listed its fields.
    query: (config: { text: string }, values: unknown[] = []) => {
      const answer = state.answers.shift();
      state.queries.push({ sql: config.text, params: values });
      if (answer && 'error' in answer) return Promise.reject(answer.error);
      return Promise.resolve({ rows: answer?.rows ?? [], rowCount: answer?.rows.length ?? 0 });
    },
  }),
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/errors-server', () => ({ logError: mockLogError }));

import { GET } from '@/app/api/superadmin/selective-restore/logs/route';

/**
 * Rows as arrays, in the order the route's select lists its fields:
 * id, backup_id, tenant_id, tenant_name, status, started_at, completed_at, error_message.
 */
const LIST_ROWS = [
  [LOG_A, BACKUP, TENANT_A, 'Acme Corp', 'completed', new Date('2026-10-19T05:00:00Z'), new Date('2026-10-19T05:00:12Z'), null],
  [LOG_B, BACKUP, TENANT_B, 'Beta LLC', 'running', new Date('2026-10-19T04:00:00Z'), null, null],
];

/** restore_log_id, envelope — the two fields the lookup selects. */
const ENVELOPE_ROWS = [[LOG_A, { restore_mode: 'upsert', tables: ['leads', 'contacts', 'deals'] }]];

function requestFor(query = ''): NextRequest {
  return new NextRequest(`http://nucrm.test/api/superadmin/selective-restore/logs${query}`);
}

async function get(query = ''): Promise<NextResponse> {
  return (await GET(requestFor(query), {} as never)) as NextResponse;
}

/** The rendered SQL of the list query — the first one the route runs. */
const listSql = (): string => state.queries[0]!.sql;
/** The rendered SQL of the envelope lookup — the second. */
const envelopeSql = (): string => state.queries[1]!.sql;

beforeEach(() => {
  state.queries = [];
  state.answers = [{ rows: LIST_ROWS }, { rows: ENVELOPE_ROWS }];
  mockRequireAuth.mockResolvedValue({ tenantId: null, userId: SUPER, isSuperAdmin: true } as never);
  mockLogError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/superadmin/selective-restore/logs — the gate (#2822)', () => {
  it('answers an anonymous caller with whatever requireAuth decided, before any query', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never);
    const res = await get();
    expect(res.status).toBe(401);
    expect(state.queries).toEqual([]);
  });

  it('refuses a tenant admin with 403, matching the sibling routes', async () => {
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_A, userId: 'u1', isSuperAdmin: false } as never);
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Super admin access required' });
    expect(state.queries).toEqual([]);
  });
});

describe('GET /api/superadmin/selective-restore/logs — what the panel renders (#2822)', () => {
  it('returns the history newest-first with the fields the table renders', async () => {
    const body = await (await get()).json();
    expect(body.logs.map((l: { id: string }) => l.id)).toEqual([LOG_A, LOG_B]);
    expect(body.logs[0]).toMatchObject({
      id: LOG_A,
      target_tenant_id: TENANT_A,
      tenant_name: 'Acme Corp',
      status: 'completed',
      restore_mode: 'upsert',
      tables_selected: ['leads', 'contacts', 'deals'],
      duration_ms: 12_000,
    });
  });

  it('reconstructs the mode and table list from the audit envelope, not from columns that do not exist', async () => {
    await get();
    // PP-044: selective_restore_audit_log has (tenantId, action, tableName, recordId,
    // oldData, newData, performedBy, performedAt) and nothing else — so the restore
    // link rides in old_data->>'restore_log_id', exactly as backups/route.ts:48
    // joins on metadata->>'uploaded_by'.
    expect(envelopeSql()).toContain('restore_log_id');
    expect(envelopeSql()).toContain('restore_mode');
    expect(envelopeSql()).toContain('jsonb_build_object');
    expect(state.queries[1]!.params).toContain(LOG_A);
    expect(state.queries[1]!.params).toContain(LOG_B);
  });

  it('leaves the mode null and the table list empty for a log with no envelope row', async () => {
    const body = await (await get()).json();
    // LOG_B has no envelope in ENVELOPE_ROWS: `-` in the Mode column, 0 in Tables —
    // the panel's own rendering of a value that was never stored.
    expect(body.logs[1]).toMatchObject({ restore_mode: null, tables_selected: [] });
    expect(body.logs[1].duration_ms).toBeUndefined();
  });

  it('invents no field the restore never stored', async () => {
    const body = await (await get()).json();
    const keys = Object.keys(body.logs[0]).sort();
    expect(keys).toEqual([
      'backup_id',
      'completed_at',
      'duration_ms',
      'error_message',
      'id',
      'restore_mode',
      'started_at',
      'status',
      'tables_selected',
      'target_tenant_id',
      'tenant_name',
    ]);
    // records_affected / records_per_table are in the page's RestoreLog type but belong
    // to the live SSE result (page.tsx:128); history never had them.
    expect(keys).not.toContain('records_affected');
  });

  it('joins the tenant for its name and filters tombstones out of the list', async () => {
    await get();
    expect(listSql()).toContain('left join "tenants"');
    expect(listSql()).toContain('"selective_restore_logs"."deleted_at" is null');
    expect(listSql()).toContain('order by "selective_restore_logs"."started_at" desc');
  });
});

describe('GET /api/superadmin/selective-restore/logs — refusals before the query (#2822)', () => {
  it('rejects a status the writer never writes instead of answering an empty 200', async () => {
    const res = await get('?status=done');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('pending, running, completed, failed');
    expect(state.queries).toEqual([]);
  });

  it('rejects a non-UUID tenant_id, which would otherwise reach Postgres as 22P02', async () => {
    // `apiError` maps a bad uuid to 404 "not found": the filter looks broken rather
    // than refused, and every retry adds a row to error_logs (#2766's finding).
    const res = await get('?tenant_id=Acme');
    expect(res.status).toBe(400);
    expect(state.queries).toEqual([]);
  });

  it('narrows on tenant_id and status when both are well-formed', async () => {
    await get(`?tenant_id=${TENANT_A}&status=failed`);
    expect(listSql()).toContain('"selective_restore_logs"."tenant_id" = $1');
    expect(listSql()).toContain('"selective_restore_logs"."status" = $2');
    expect(state.queries[0]!.params).toEqual([TENANT_A, 'failed', 50]);
  });

  it('caps the page at 200 and never hands drizzle a LIMIT it would silently drop', async () => {
    // drizzle only emits the clause when the bound value satisfies
    // `typeof n === 'number' && n >= 0`; `NaN` and negatives delete the cap (#2664, #2766).
    const keepsClause = (n: unknown): boolean =>
      typeof n === 'object' || (typeof n === 'number' && n >= 0);
    const boundLimit = async (raw: string): Promise<number> => {
      state.queries = [];
      state.answers = [{ rows: LIST_ROWS }, { rows: ENVELOPE_ROWS }];
      await get(`?limit=${raw}`);
      return state.queries[0]!.params.at(-1) as number;
    };
    expect(await boundLimit('9999')).toBe(200);
    expect(await boundLimit('25')).toBe(25);
    expect(await boundLimit('25.7')).toBe(25);
    expect(await boundLimit('0')).toBe(1);
    expect(await boundLimit('-5')).toBe(1);
    expect(await boundLimit('')).toBe(50);
    expect(await boundLimit('abc')).toBe(50);
    for (const raw of ['9999', '0', '-5', 'abc', '', '25.7']) {
      expect(keepsClause(await boundLimit(raw)), `?limit=${raw}`).toBe(true);
    }
  });

  it('skips the envelope lookup when there is nothing to look up', async () => {
    state.answers = [{ rows: [] }];
    const body = await (await get()).json();
    expect(body.logs).toEqual([]);
    expect(state.queries.length).toBe(1);
  });
});

describe('GET /api/superadmin/selective-restore/logs — a refused read is not an empty history (#2822)', () => {
  it('answers 5xx rather than { logs: [] } when the query fails', async () => {
    // The sibling `backups` list ends its query with `.catch(() => [])`. Copied here,
    // this endpoint would answer a dead database with "no restores have ever run" —
    // the exact lie #2829 is about, and #2823 gave this panel an error branch that
    // only works if the failure reaches it.
    state.answers = [{ error: new Error('connection terminated') }];
    const res = await get();
    expect(res.status, await res.text()).toBeGreaterThanOrEqual(500);
    expect(state.queries.length).toBe(1);
    expect(mockLogError).toHaveBeenCalled();
  });
});

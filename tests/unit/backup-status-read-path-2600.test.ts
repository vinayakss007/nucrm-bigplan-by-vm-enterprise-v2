import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Issue #2600 — /api/system/backup-status is the endpoint an operator or an
 * external monitor curls to answer "are we backed up?" (it has no first-party
 * consumer; docs/runbooks/disaster-recovery.md tells a human to fetch it).
 *
 * It used to derive `healthy` from the NEWEST backup_records row whatever its
 * status, so a dump that failed an hour after a success answered `healthy: true`
 * — and it returned that failure as `last_backup`. Measured on the live database
 * 2026-10-13: newest row `status='failed'` (pg_dump role lacks BYPASSRLS), plus 19
 * rows in backup_alerts with `resolved = false` that no GET surface had ever read.
 *
 * These tests pin the two things that make the answer honest:
 *  - `healthy`/`last_backup` come only from a COMPLETED backup, and the newest
 *    failure is reported separately instead of disguised as the good news;
 *  - the open-alert trail is returned, so the alerts have a reader;
 *  - and the predicates that say so are asserted as the SQL actually sent (the
 *    same technique lib/cron/auto-backup-sql.ts exists for), not as a mock echo.
 */

const dialect = new PgDialect();

const mockRequireAuth = vi.fn();
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(fn: T) => fn }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => Response.json({ error: String(err) }, { status: 500 }),
}));

/**
 * One queue per awaited select, in the order the route issues them:
 * [0] newest completed, [1] newest failed, [2] total count, [3] schedules, [4] alerts.
 * `whereArgs` captures every WHERE fragment so the tests can render the real SQL.
 */
let selectQueue: unknown[][] = [];
let whereArgs: unknown[] = [];

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = (arg: unknown) => { whereArgs.push(arg); return chain; };
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.limit = () => chain;
  return Object.assign(chain, {
    then: (onFulfilled: (v: unknown) => unknown) => onFulfilled(selectQueue.shift() ?? []),
  });
}

vi.mock('@/drizzle/db', () => ({
  db: { select: vi.fn(() => makeChain()) },
}));

const { GET } = await import('@/app/api/system/backup-status/route');

const REQ = { url: 'http://localhost/api/system/backup-status' } as unknown as import('next/server').NextRequest;

/** The WHERE fragments, rendered to the SQL Postgres would receive. */
function sqlOf(index: number): string {
  return dialect.sqlToQuery(whereArgs[index] as never).sql.replace(/\s+/g, ' ');
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  whereArgs = [];
  mockRequireAuth.mockResolvedValue({ userId: 'admin-1', isSuperAdmin: true });
});

describe('GET /api/system/backup-status — health means restorable', () => {
  it('reports unhealthy and no last_backup when the only recent row failed', async () => {
    // The exact live shape at 2026-10-13: no completed backup, one failed one
    // written 2 hours ago. The pre-#2600 route read that row as `latest`, found
    // it 2 h old, and answered healthy:true.
    selectQueue = [
      [],
      [{ id: 'b1', backupType: 'full', status: 'failed', createdAt: hoursAgo(2), errorMessage: 'Backup refused: pg_dump role "nucrm" is neither superuser nor BYPASSRLS' }],
      [{ count: 4 }],
      [],
      [],
    ];
    const body = await (await GET(REQ)).json();
    expect(body.data.healthy).toBe(false);
    expect(body.data.last_backup).toBeNull();
    expect(body.data.last_failure).toMatchObject({ id: 'b1', status: 'failed' });
    expect(body.data.last_failure.error_excerpt).toContain('BYPASSRLS');
  });

  it('truncates a long stored error instead of echoing the whole row', async () => {
    selectQueue = [[], [{ id: 'b1', backupType: 'full', status: 'failed', createdAt: hoursAgo(1), errorMessage: 'x'.repeat(900) }], [{ count: 1 }], [], []];
    const body = await (await GET(REQ)).json();
    // `truncateForStore` is the house cap: the reader has to be able to tell a
    // 300-char excerpt from a 300-char error, so the marker names what was cut.
    const excerpt: string = body.data.last_failure.error_excerpt;
    expect(excerpt).toContain('600 chars omitted');
    expect(excerpt.startsWith('x'.repeat(300))).toBe(true);
    expect(excerpt).not.toContain('x'.repeat(301));
  });

  it('is healthy from a completed backup and still surfaces an older failure', async () => {
    selectQueue = [
      [{ id: 'good', backupType: 'full', completedAt: hoursAgo(3), sizeBytes: 1024, storageType: 's3', lastVerifiedAt: hoursAgo(2), verifiedOk: true }],
      [{ id: 'bad', backupType: 'full', status: 'failed', createdAt: hoursAgo(27), errorMessage: null }],
      [{ count: 7 }],
      [],
      [],
    ];
    const body = await (await GET(REQ)).json();
    expect(body.data.healthy).toBe(true);
    expect(body.data.last_backup).toMatchObject({ id: 'good', status: 'completed', verified_ok: true });
    expect(body.data.age_hours).toBeCloseTo(3, 0);
    expect(body.data.last_failure.id).toBe('bad');
  });

  it('marks a stale completed backup unhealthy rather than trusting the row exists', async () => {
    selectQueue = [[{ id: 'old', backupType: 'full', completedAt: hoursAgo(40), sizeBytes: null, storageType: 'local', lastVerifiedAt: null, verifiedOk: null }], [], [{ count: 1 }], [], []];
    const body = await (await GET(REQ)).json();
    expect(body.data.healthy).toBe(false);
    expect(body.data.last_backup.id).toBe('old');
  });

  it('selects completed rows only, and failed rows only, as SQL', async () => {
    selectQueue = [[], [], [], [], []];
    await GET(REQ);
    expect(whereArgs).toHaveLength(4); // completed, failed, schedules, alerts
    expect(sqlOf(0)).toMatch(/"backup_records"."status" = \$1/i);
    expect(sqlOf(0)).toMatch(/"backup_records"."completed_at" IS NOT NULL/i);
    expect(sqlOf(1)).toMatch(/"backup_records"."status" = \$1/i);
    expect(dialect.sqlToQuery(whereArgs[1] as never).params).toEqual(['failed']);
  });
});

describe('GET /api/system/backup-status — schedules and alerts', () => {
  it('excludes tombstoned schedules, matching the #2393 liveness rule', async () => {
    selectQueue = [[], [], [], [], []];
    await GET(REQ);
    expect(sqlOf(2)).toMatch(/"backup_schedules"."enabled" = \$1/i);
    expect(sqlOf(2)).toMatch(/"backup_schedules"."deleted_at" is null/i);
  });

  it('reports the soonest schedule, not whichever row came back first', async () => {
    selectQueue = [[], [], [], [
      { id: 's1', tenantId: null, scheduleType: 'monthly', nextRunAt: null },
      { id: 's2', tenantId: null, scheduleType: 'daily', nextRunAt: hoursAgo(-6) },
    ], []];
    const body = await (await GET(REQ)).json();
    expect(body.data.active_schedules).toBe(2);
    expect(new Date(body.data.next_scheduled).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns the unresolved alert trail so the alerts have a reader', async () => {
    selectQueue = [[], [], [], [], [
      { alertType: 'no_backup_to_verify', count: 13, oldest: new Date('2026-10-01T06:47:42Z') },
      { alertType: 'no_backup', count: 5, oldest: new Date('2026-09-25T06:10:06Z') },
      { alertType: 'verify_error', count: 1, oldest: new Date('2026-10-03T04:00:19Z') },
    ]];
    const body = await (await GET(REQ)).json();
    expect(sqlOf(3)).toMatch(/"backup_alerts"."resolved" = \$1/i);
    expect(body.data.open_alerts.count).toBe(19);
    expect(body.data.open_alerts.by_type).toEqual([
      { alert_type: 'no_backup_to_verify', count: 13 },
      { alert_type: 'no_backup', count: 5 },
      { alert_type: 'verify_error', count: 1 },
    ]);
    // Oldest across types, not oldest within the first group.
    expect(body.data.open_alerts.oldest_unresolved_at).toBe('2026-09-25T06:10:06.000Z');
  });

  it('stays a super-admin-only read', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u2', isSuperAdmin: false });
    const res = await GET(REQ);
    expect(res.status).toBe(403);
  });
});

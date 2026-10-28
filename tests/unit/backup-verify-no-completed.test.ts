import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sentry 7765362431: backup-verify page-alarms "the platform backup job has
// never produced an artefact" while backup_records holds failed attempts whose
// error_message names the real cause (pg_dump role lacks BYPASSRLS, PP-014).
// The route must surface the last attempt instead of the false "never" claim.

const mockInsertValues = vi.fn(async () => {});
vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ insert: () => ({ values: mockInsertValues }) }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
// #3298: this route authenticates through lib/auth/cron rather than comparing the
// secret itself, so that is the module to stub. Allow/deny semantics are pinned in
// auth-cron-verify-secret.test.ts, the denial record in cron-task-reminders.test.ts,
// and that the route reaches them at all is pinned in cron-auth-screen-3298.test.ts.
// What this spec owns is the job's own logic.
vi.mock('@/lib/auth/cron', () => ({ verifyCronSecret: vi.fn(async () => true) }));
vi.mock('@/lib/cron/cron-lock', () => ({ refuseIfCronLockHeld: vi.fn(async () => null) }));
vi.mock('@/lib/email/service', () => ({ alertSuperAdmin: vi.fn(async () => {}) }));
vi.mock('@/lib/backups/backup-service', () => ({ pgLibpqEnv: (u: string) => ({ PGURL: u }) }));
vi.mock('@/lib/db/ssl-config', () => ({ pgSslConfig: () => undefined }));
vi.mock('pg', () => ({
  Pool: class MockPool {
    async query() { return { rows: [] }; }
    async end() {}
  },
}));

// Each db.select(...).from(...)... .limit(1) consumes the next queued row set:
// [0] the completed-backup lookup, [1] the last-attempt lookup.
// `query.backupAlerts.findFirst` answers #2600's duplicate guard — returning
// undefined means "no alert of this type is open yet", so the insert below runs.
let selectQueue: unknown[][] = [];
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
      return chain;
    },
    query: {
      backupAlerts: { findFirst: async () => undefined },
    },
  },
}));

import { POST } from '@/app/api/cron/backup-verify/route';

function makeRequest() {
  return new Request('http://localhost/api/cron/backup-verify', {
    method: 'POST',
    headers: { 'x-cron-secret': 'irrelevant-mocked' },
  }) as unknown as import('next/server').NextRequest;
}

describe('cron/backup-verify — no completed backup diagnosis', () => {
  beforeEach(() => {
    selectQueue = [];
    mockInsertValues.mockClear();
    process.env.DATABASE_URL = 'postgresql://nucrm@localhost:5432/nucrm';
    delete process.env.BACKUP_DATABASE_URL;
  });

  it('surfaces the most recent failed attempt error instead of claiming no artefact ever existed', async () => {
    selectQueue = [
      [], // no completed backup
      [
        {
          backupType: 'full',
          status: 'failed',
          errorMessage:
            'Backup refused: pg_dump role "nucrm" is neither superuser nor BYPASSRLS. Set BACKUP_DATABASE_URL to a connection as a role with BYPASSRLS.',
          createdAt: new Date('2026-10-03T05:36:05Z'),
        },
      ],
    ];
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.cause).toBe('no_backup_to_verify');
    expect(body.last_attempt).toEqual({ status: 'failed', at: '2026-10-03T05:36:05.000Z' });
    expect(body.failures[0]).toContain('ended as "failed"');
    expect(body.failures[0]).toContain('BYPASSRLS');
    expect(body.failures[0]).not.toContain('never produced an artefact');
    // The alert row written for the operator carries the same corrected text.
    const alertValues = mockInsertValues.mock.calls[0]?.[0] as { alertType: string; message: string };
    expect(alertValues.alertType).toBe('no_backup_to_verify');
    expect(alertValues.message).toContain('BYPASSRLS');
  });

  it('keeps a true never-ran message when backup_records is empty', async () => {
    selectQueue = [[], []];
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.failures[0]).toContain('No backup records at all');
    expect(body.last_attempt).toBeUndefined();
  });
});

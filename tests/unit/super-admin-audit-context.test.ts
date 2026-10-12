import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Pins the two defects that made the super-admin audit trail useless even when
 * an INSERT was attempted:
 *
 * 1. `db.execute()` on node-postgres answers with the driver's QueryResult
 *    (`{ rows, … }`), not a row array. Reading the chain head as `result[0]`
 *    was always undefined, so EVERY row was written with previous_hash NULL —
 *    48 rows, zero links, and a verifier that looped over `undefined.length`
 *    and reported "valid, 0 checked".
 * 2. The write depended on `app.is_super_admin` still being set on whichever
 *    connection happened to run it, while `tenant_isolation`'s WITH CHECK
 *    requires `tenant_id = current_setting('app.current_tenant')`. A detached
 *    call therefore landed on a released, GUC-reset connection and Postgres
 *    answered 42501 (`super_admin_audit_logs` has 2 PERMISSIVE policies and the
 *    super-admin one has no WITH CHECK, so it cannot waive the tenant one).
 *
 * Statements are rendered with PgDialect so the assertions read real SQL.
 */
const dialect = new PgDialect();

function readQuery(q: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(q as Parameters<PgDialect['sqlToQuery']>[0]);
}

let statements: { sql: string; params: unknown[] }[] = [];
let chainHead: string | null = null;
let transactionDepth = 0;
let maxTransactionDepth = 0;

const execute = vi.fn(async (raw: unknown) => {
  const q = readQuery(raw);
  statements.push(q);
  if (/SELECT hash FROM super_admin_audit_logs/i.test(q.sql)) {
    // Exactly what node-postgres returns for a SELECT.
    return { rows: chainHead === null ? [] : [{ hash: chainHead }], command: 'SELECT' };
  }
  if (/COUNT\(\*\) as total/i.test(q.sql)) return { rows: [{ total: '2' }], command: 'SELECT' };
  if (/INSERT INTO super_admin_audit_logs/i.test(q.sql)) {
    chainHead = q.params[15] as string;
    return { rows: [], command: 'INSERT' };
  }
  return { rows: [], command: 'SELECT' };
});

const db = {
  execute,
  async transaction(fn: (tx: unknown) => Promise<unknown>) {
    transactionDepth += 1;
    maxTransactionDepth = Math.max(maxTransactionDepth, transactionDepth);
    try {
      return await fn({ execute });
    } finally {
      transactionDepth -= 1;
    }
  },
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const ADMIN = { adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', adminEmail: 'admin@example.com' };

function sqlOf(pattern: RegExp): string | undefined {
  return statements.find((s) => pattern.test(s.sql))?.sql;
}

async function load() {
  vi.resetModules();
  return import('@/lib/audit/super-admin');
}

describe('super admin audit writer — connection-independent context', () => {
  beforeEach(() => {
    statements = [];
    chainHead = null;
    transactionDepth = 0;
    maxTransactionDepth = 0;
    execute.mockClear();
  });

  it('runs the whole write inside one transaction that carries app.is_super_admin', async () => {
    const { logSuperAdminAction } = await load();
    await logSuperAdminAction({ ...ADMIN, action: 'tenant.settings_changed', tenantId: 't-1' });

    expect(sqlOf(/set_config\('app.is_super_admin'/i)).toMatch(/app.is_super_admin/);
    // SET LOCAL (is_local = true), never a session GUC that could outlive the write.
    // rls.ts inlines both the value and the is_local flag, so assert on the text.
    const setCfg = statements.find((s) => /set_config\('app.is_super_admin'/i.test(s.sql));
    expect(setCfg?.sql).toMatch(/set_config\('app.is_super_admin', 'true', true\)/i);
    expect(maxTransactionDepth).toBe(1);
  });

  it('serialises chain-head read behind the advisory lock', async () => {
    const { logSuperAdminAction } = await load();
    await logSuperAdminAction({ ...ADMIN, action: 'settings.changed' });

    const lockAt = statements.findIndex((s) => /pg_advisory_xact_lock/i.test(s.sql));
    const readAt = statements.findIndex((s) => /SELECT hash FROM super_admin_audit_logs/i.test(s.sql));
    const insertAt = statements.findIndex((s) => /INSERT INTO super_admin_audit_logs/i.test(s.sql));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeLessThan(readAt);
    expect(readAt).toBeLessThan(insertAt);
  });

  it('links rows when the driver answers with a QueryResult', async () => {
    const { logSuperAdminAction } = await load();
    await logSuperAdminAction({ ...ADMIN, action: 'settings.changed' });
    const firstHash = statements.filter((s) => /INSERT INTO super_admin_audit_logs/i.test(s.sql)).pop()!.params[15];
    await logSuperAdminAction({ ...ADMIN, action: 'settings.changed' });
    const second = statements.filter((s) => /INSERT INTO super_admin_audit_logs/i.test(s.sql)).pop()!;

    expect(second.params[14]).toBe(firstHash);
  });
});

describe('super admin audit chain verifier', () => {
  beforeEach(() => {
    statements = [];
    chainHead = null;
    execute.mockClear();
  });

  /** A stored row, hashed the way the writer hashes it. */
  function auditRow(overrides: Record<string, unknown>): Record<string, unknown> {
    const base: Record<string, unknown> = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      admin_id: ADMIN.adminId, admin_email: ADMIN.adminEmail, action: 'settings.changed',
      target_type: null, target_id: null, target_name: null, tenant_id: null, tenant_name: null,
      ip_address: null, user_agent: null, old_data: null, new_data: null, metadata: null,
      previous_hash: null,
    };
    const row = { ...base, ...overrides };
    const canonical = JSON.stringify({
      adminId: row.admin_id, adminEmail: row.admin_email, action: row.action,
      targetType: row.target_type, targetId: row.target_id, targetName: row.target_name,
      tenantId: row.tenant_id, tenantName: row.tenant_name, ipAddress: row.ip_address,
      userAgent: row.user_agent, oldData: row.old_data, newData: row.new_data,
      metadata: row.metadata, previousHash: row.previous_hash,
    });
    row.hash = createHash('sha256').update(canonical).digest('hex');
    return row;
  }

  function stubSelect(rows: Record<string, unknown>[]) {
    execute.mockImplementationOnce(async (raw: unknown) => {
      const q = readQuery(raw);
      statements.push(q);
      return /SELECT id, admin_id/i.test(q.sql) ? { rows, command: 'SELECT' } : { rows: [], command: 'SELECT' };
    });
  }

  it('counts the rows the driver returned instead of reporting zero', async () => {
    const { verifySuperAdminAuditChain } = await load();
    // Two unlinked rows: every row the pre-fix writer produced.
    stubSelect([auditRow({}), auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(true);
    expect(result.totalChecked).toBe(2);
    expect(result.unlinkedRows).toBe(1);
    expect(result.details).toMatch(/predate chain linking/);
  });

  it('does not treat the genesis row as an unlinked legacy row', async () => {
    const { verifySuperAdminAuditChain } = await load();
    const first = auditRow({});
    stubSelect([first, auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', previous_hash: first.hash })]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(true);
    expect(result.unlinkedRows).toBe(0);
    expect(result.details).toMatch(/verified successfully/);
  });

  it('accepts a linked pair and reports no unlinked head', async () => {
    const { verifySuperAdminAuditChain } = await load();
    const first = auditRow({});
    const second = auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', previous_hash: first.hash });
    stubSelect([first, second]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(true);
    expect(result.totalChecked).toBe(2);
    expect(result.unlinkedRows).toBe(0);
  });

  it('reports a broken link in the chained segment', async () => {
    const { verifySuperAdminAuditChain } = await load();
    const first = auditRow({});
    stubSelect([
      first,
      auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', previous_hash: 'not-the-previous-hash' }),
    ]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
    expect(result.brokenAtReason).toBe('link');
    expect(result.details).toMatch(/chain broken/i);
  });

  it('still detects content tampering inside the unlinked head', async () => {
    const { verifySuperAdminAuditChain } = await load();
    const row = auditRow({});
    row.action = 'data.exported'; // rewritten after it was hashed
    stubSelect([row]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtReason).toBe('content');
    expect(result.details).toMatch(/no longer hash to the value it stores/);
  });

  /**
   * The live trail contains one hand-made probe row whose hash column is the
   * string "x". Walking past it is what lets the 68 genuinely chained rows after
   * it be verified at all — but the walk must still report the row, and must
   * still find real tampering downstream of it.
   */
  it('records an unhashed row and keeps verifying past it', async () => {
    const { verifySuperAdminAuditChain } = await load();
    const probe = auditRow({});
    probe.hash = 'x'; // written by hand, not by the audit writer
    stubSelect([probe, auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', previous_hash: 'x' })]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtReason).toBe('never-hashed');
    expect(result.brokenAtIndex).toBe(0);
    expect(result.totalChecked).toBe(2);
  });

  it('does not let an unhashed row hide a tampered successor', async () => {
    const { verifySuperAdminAuditChain } = await load();
    const probe = auditRow({});
    probe.hash = 'x';
    const follower = auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', previous_hash: 'x' });
    follower.action = 'data.exported'; // hashed, then rewritten
    stubSelect([probe, follower]);
    const result = await verifySuperAdminAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtReason).toBe('content');
    expect(result.brokenAtIndex).toBe(1);
  });
});

describe('super admin audit reader', () => {
  beforeEach(() => {
    statements = [];
    execute.mockClear();
  });

  it('returns an array of rows, not the driver result object', async () => {
    const { getSuperAdminAuditLogs } = await load();
    execute.mockImplementation(async (raw: unknown) => {
      const q = readQuery(raw);
      statements.push(q);
      if (/COUNT\(\*\) as total/i.test(q.sql)) return { rows: [{ total: '7' }], command: 'SELECT' };
      return { rows: [{ id: 'x', action: 'settings.changed' }], command: 'SELECT' };
    });
    const out = await getSuperAdminAuditLogs({ limit: 10 });
    expect(Array.isArray(out.data)).toBe(true);
    expect(out.data).toHaveLength(1);
    expect(out.total).toBe(7);
  });
});

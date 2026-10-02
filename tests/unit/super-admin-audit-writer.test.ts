import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Captures every statement the audit writer issues so the assertions can look at
 * the actual SQL parameters rather than a re-implementation of the helper.
 * `SQL#toQuery()` needs driver context it only gets inside a real `db.execute`,
 * so the dialect is used to render the statement standalone.
 */
const dialect = new PgDialect();
let statements: { sql: string; params: unknown[] }[] = [];

function readQuery(q: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(q as Parameters<PgDialect['sqlToQuery']>[0]);
}

const execute = vi.fn((raw: unknown) => {
  const q = readQuery(raw);
  if (/SELECT hash FROM super_admin_audit_logs/i.test(q.sql)) {
    const inserts = statements.filter((s) => /INSERT INTO super_admin_audit_logs/i.test(s.sql));
    const last = inserts[inserts.length - 1];
    return Promise.resolve(last ? [{ hash: last.params[15] }] : []);
  }
  statements.push(q);
  return Promise.resolve([]);
});

vi.mock('@/drizzle/db', () => ({ db: { execute: (raw: unknown) => execute(raw) } }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN = { adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', adminEmail: 'admin@example.com' };

function lastInsert(): { sql: string; params: unknown[] } {
  const inserts = statements.filter((s) => /INSERT INTO super_admin_audit_logs/i.test(s.sql));
  expect(inserts.length).toBeGreaterThan(0);
  return inserts[inserts.length - 1];
}

describe('super admin audit writer', () => {
  let logSuperAdminAction: typeof import('@/lib/audit/super-admin').logSuperAdminAction;
  let verifySuperAdminAuditChain: typeof import('@/lib/audit/super-admin').verifySuperAdminAuditChain;

  beforeEach(async () => {
    statements = [];
    execute.mockClear();
    execute.mockImplementation((raw: unknown) => {
      const q = readQuery(raw);
      if (/SELECT hash FROM super_admin_audit_logs/i.test(q.sql)) {
        const inserts = statements.filter((s) => /INSERT INTO super_admin_audit_logs/i.test(s.sql));
        const last = inserts[inserts.length - 1];
        return Promise.resolve(last ? [{ hash: last.params[15] }] : []);
      }
      statements.push(q);
      return Promise.resolve([]);
    });
    vi.resetModules();
    const mod = await import('@/lib/audit/super-admin');
    logSuperAdminAction = mod.logSuperAdminAction;
    verifySuperAdminAuditChain = mod.verifySuperAdminAuditChain;
  });

  it('writes a real uuid as the primary key', async () => {
    // `id` lost its gen_random_uuid() default when 0061 retyped the column to
    // uuid, and the writer used to pass randomBytes(16).toString('hex') — 32 bare
    // hex chars, which Postgres rejects with 22P02. Every audit insert failed and
    // the failure was swallowed, so the tamper-evident trail had 0 rows.
    await logSuperAdminAction({ ...ADMIN, action: 'settings.changed' });
    expect(lastInsert().params[0]).toMatch(UUID_RE);
  });

  it('binds a value for every column it names', async () => {
    await logSuperAdminAction({ ...ADMIN, action: 'tenant.created' });
    const { sql, params } = lastInsert();
    const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(') VALUES')).split(',').length;
    // 17 columns, 16 parameters — created_at is the literal NOW(). Asserting both
    // counts catches a column/value list that has drifted apart by one.
    expect(columns).toBe(17);
    expect(params).toHaveLength(16);
  });

  it('keeps a uuid target in the target_id column', async () => {
    await logSuperAdminAction({
      ...ADMIN,
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const params = lastInsert().params;
    expect(params[5]).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(String(params[13])).not.toMatch(/target_id_raw/);
  });

  it('does not abort on a non-uuid target — null column, raw value preserved', async () => {
    // The modules route audits `targetId: v.module_id` and modules.id is a text
    // slug, so 'whatsapp' into a uuid column threw 22P02 and lost the row.
    await logSuperAdminAction({
      ...ADMIN,
      action: 'settings.changed',
      targetType: 'module',
      targetId: 'whatsapp',
    });
    const params = lastInsert().params;
    expect(params[5]).toBeNull();
    expect(JSON.parse(String(params[13]))).toMatchObject({ target_id_raw: 'whatsapp' });
  });

  it('links each row to the previous row hash', async () => {
    await logSuperAdminAction({ ...ADMIN, action: 'settings.changed' });
    const firstHash = lastInsert().params[15];
    await logSuperAdminAction({ ...ADMIN, action: 'settings.changed' });
    expect(lastInsert().params[14]).toBe(firstHash);
  });

  it('hashes the row as stored, so a normalised target still verifies end-to-end', async () => {
    await logSuperAdminAction({
      ...ADMIN,
      action: 'feature_flag.toggled',
      targetType: 'module',
      targetId: 'sms',
      metadata: { is_available: true },
    });
    const p = lastInsert().params;

    // Replay the verifier's own recomputation from the stored columns. If the
    // writer hashed the caller's raw 'sms' instead of the stored NULL + metadata,
    // this is exactly the mismatch verifySuperAdminAuditChain would report.
    const canonical = JSON.stringify({
      adminId: p[1],
      adminEmail: p[2],
      action: p[3],
      targetType: p[4],
      targetId: p[5],
      targetName: p[6],
      tenantId: p[7],
      tenantName: p[8],
      ipAddress: p[9],
      userAgent: p[10],
      oldData: p[11],
      newData: p[12],
      metadata: p[13],
      previousHash: p[14],
    });
    expect(p[15]).toBe(createHash('sha256').update(canonical).digest('hex'));
  });

  it('reports an empty trail as valid rather than throwing', async () => {
    execute.mockImplementationOnce((raw: unknown) => {
      const q = readQuery(raw);
      return /SELECT id, admin_id/i.test(q.sql) ? Promise.resolve([]) : Promise.resolve([]);
    });
    await expect(verifySuperAdminAuditChain()).resolves.toMatchObject({
      valid: true,
      totalChecked: 0,
    });
  });

  it('never rejects: a failing write is logged, not thrown at the caller', async () => {
    execute.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await expect(
      logSuperAdminAction({ ...ADMIN, action: 'settings.changed' }),
    ).resolves.toBeUndefined();
  });
});

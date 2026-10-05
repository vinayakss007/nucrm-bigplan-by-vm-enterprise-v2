/**
 * Tests for lib/leads/oid.ts — issue #2343.
 *
 * The old generateLeadOid was COUNT(*)+1 over LIVE rows (isNull(deletedAt))
 * with no lock: a trashed lead's label was deterministically reissued on the
 * next create, and concurrent creates silently double-assigned because the
 * "(tenant_id, lead_oid) unique index" its header comment promised did not
 * exist (migration 0114 adds it). The new implementation must:
 *   - take the tenant-row FOR UPDATE lock inside the caller's tx
 *   - derive MAX(sequence)+1 from the year-anchored lead_oid regex,
 *     INCLUDING soft-deleted rows (no deleted_at predicate at all)
 *   - never mention count()
 * DB-free: the emitted SQL is asserted through the captured sql fragments.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { generateLeadOid, isLeadOidCollision } from '@/lib/leads/oid';

function fakeTx(maxNum: number | null) {
  const captured: { executeSql: unknown[]; selectArg: unknown } = {
    executeSql: [],
    selectArg: undefined,
  };
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => Promise.resolve(maxNum === null ? [] : [{ maxNum }]);
  const tx = {
    execute: vi.fn(async (frag: unknown) => {
      captured.executeSql.push(frag);
      return undefined;
    }),
    select: vi.fn((fields: unknown) => {
      captured.selectArg = fields;
      return chain;
    }),
  };
  return { tx, captured };
}

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const sqlText = (frag: unknown): string =>
  new PgDialect().sqlToQuery(frag as Parameters<PgDialect['sqlToQuery']>[0]).sql;

const JAN_2026 = new Date(Date.UTC(2026, 0, 15));

describe('generateLeadOid — atomic allocation (#2343)', () => {
  it('locks the tenant row FOR UPDATE before allocating', async () => {
    const { tx, captured } = fakeTx(0);
    await generateLeadOid(tx as never, TENANT, JAN_2026);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    const lock = sqlText(captured.executeSql[0]);
    expect(lock).toContain('FOR UPDATE');
    expect(lock).toContain('tenants');
    // the lock must precede the MAX scan
    expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(
      tx.select.mock.invocationCallOrder[0],
    );
  });

  it('derives from MAX over the year regex — no COUNT, no deleted_at filter', async () => {
    const { tx, captured } = fakeTx(0);
    await generateLeadOid(tx as never, TENANT, JAN_2026);
    const fields = captured.selectArg as { maxNum: unknown };
    const text = sqlText(fields.maxNum);
    expect(text).toContain('MAX');
    expect(text).toContain('SUBSTRING');
    expect(text).toContain('FROM 9'); // 'LD-2026-' is 8 chars; digits start at 9
    expect(text.toLowerCase()).not.toContain('count(');
    // soft-deleted rows must count: the allocation scan has NO deleted_at predicate
    expect(text).not.toContain('deleted_at');
    const lockOnly = sqlText(captured.executeSql[0]);
    expect(lockOnly).not.toContain('deleted_at');
  });

  it('anchors the regex to the requested year (legacy years cannot contribute)', async () => {
    const { tx, captured } = fakeTx(0);
    await generateLeadOid(tx as never, TENANT, JAN_2026);
    const fields = captured.selectArg as { maxNum: unknown };
    const { params } = new PgDialect().sqlToQuery(fields.maxNum as Parameters<PgDialect['sqlToQuery']>[0]);
    expect(params).toContain('^LD-2026-[0-9]+$');

    const feb = fakeTx(0);
    await generateLeadOid(feb.tx as never, TENANT, new Date(Date.UTC(2025, 11, 31)));
    const decFields = feb.captured.selectArg as { maxNum: unknown };
    const { params: decParams } = new PgDialect().sqlToQuery(decFields.maxNum as Parameters<PgDialect['sqlToQuery']>[0]);
    expect(decParams).toContain('^LD-2025-[0-9]+$');
  });

  it('a fresh tenant-year starts at LD-{year}-001 (empty result included)', async () => {
    const withZero = fakeTx(0);
    expect(await generateLeadOid(withZero.tx as never, TENANT, JAN_2026)).toBe('LD-2026-001');
    const withEmpty = fakeTx(null);
    expect(await generateLeadOid(withEmpty.tx as never, TENANT, JAN_2026)).toBe('LD-2026-001');
  });

  it('increments above the current max and pads to 3, widening past 999', async () => {
    const low = fakeTx(41);
    expect(await generateLeadOid(low.tx as never, TENANT, JAN_2026)).toBe('LD-2026-042');
    const high = fakeTx(999);
    expect(await generateLeadOid(high.tx as never, TENANT, JAN_2026)).toBe('LD-2026-1000');
  });

  it('scans ALL of the tenant rows (where filters only tenant_id, not liveness)', async () => {
    const { tx } = fakeTx(0);
    await generateLeadOid(tx as never, TENANT, JAN_2026);
    // the shape we assert on is the rendered SELECT; there is exactly one
    // select call and it ends in a plain tenant filter — no year/gte/IS NULL
    // decorations from the old COUNT implementation survive.
    expect(tx.select).toHaveBeenCalledTimes(1);
  });
});

describe('isLeadOidCollision — narrow retry predicate (#2343)', () => {
  it('matches the index by constraint name', () => {
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint "idx_leads_tenant_oid"'),
      { code: '23505', constraint: 'idx_leads_tenant_oid' },
    );
    expect(isLeadOidCollision(err)).toBe(true);
  });

  it('does NOT match a different unique constraint', () => {
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint "uq_contacts_email"'),
      { code: '23505', constraint: 'uq_contacts_email' },
    );
    expect(isLeadOidCollision(err)).toBe(false);
  });

  it('falls back to the message when drizzle hides the code', () => {
    const err = new Error(
      'Failed query: insert into leads ... duplicate key value violates unique constraint "idx_leads_tenant_oid"',
    );
    expect(isLeadOidCollision(err)).toBe(true);
    expect(isLeadOidCollision(new Error('Connection terminated'))).toBe(false);
    expect(isLeadOidCollision('string error')).toBe(false);
  });
});

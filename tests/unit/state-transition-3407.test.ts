/**
 * #3407 PR-4A — the one status-write helper. These tests pin the SQL claim:
 * id, tenant, from-state and tombstone gate all travel in the UPDATE's WHERE,
 * and a lost claim is classified, never reported as a successful no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ kind: 'eq', column, value })),
  inArray: vi.fn((column: unknown, values: unknown) => ({ kind: 'inArray', column, values })),
  isNull: vi.fn((column: unknown) => ({ kind: 'isNull', column })),
  and: vi.fn((...parts: unknown[]) => ({ kind: 'and', parts })),
}));
vi.mock('drizzle-orm', () => m);

import { transitionStatus, transitionStatusResponse } from '../../lib/state/transition';

const columns = {
  id: { name: 'id' },
  tenantId: { name: 'tenant_id' },
  status: { name: 'status' },
  deletedAt: { name: 'deleted_at' },
};
const table = { __name: 'invoices', ...columns };

function makeDb(opts: { exists: boolean; rows?: unknown[] } = { exists: true }) {
  const set = vi.fn((values: Record<string, unknown>) => ({ values, where: whereFn }));
  const whereFn = vi.fn((condition: unknown) => ({ condition, returning: async () => opts.rows ?? [] }));
  const fromFn = vi.fn(() => ({ where: () => ({ limit: async () => (opts.exists ? [{ id: 'inv-1' }] : []) }) }));
  const db = {
    select: vi.fn(() => ({ from: fromFn })),
    update: vi.fn(() => ({ set })),
  };
  return { db: db as never, set, whereFn, fromFn, call: set };
}

describe('transitionStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('claims the from-state with id, tenant and tombstone in the WHERE', async () => {
    const row = { id: 'inv-1', status: 'sent' };
    const { db, set, whereFn } = makeDb({ exists: true, rows: [row] });
    const outcome = await transitionStatus(db, {
      table,
      id: 'inv-1',
      tenantId: 'tenant-1',
      from: ['draft', 'sent'],
      to: 'cancelled',
      patch: { updatedBy: 'user-1' },
    });

    expect(outcome).toEqual({ ok: true, row });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', updatedBy: 'user-1' }),
    );
    expect(m.inArray).toHaveBeenCalledWith(columns.status, ['draft', 'sent']);
    expect(m.eq).toHaveBeenCalledWith(columns.id, 'inv-1');
    expect(m.eq).toHaveBeenCalledWith(columns.tenantId, 'tenant-1');
    expect(m.isNull).toHaveBeenCalledWith(columns.deletedAt);
    const claimParts = m.and.mock.results
      .map((result) => (result.value as { parts: Array<{ kind?: string; values?: unknown }> }).parts)
      .find((parts) => parts.some((p) => p.kind === 'inArray'));
    expect(claimParts?.some((p) => p.kind === 'inArray' && p.values && (p.values as string[]).join(',') === 'draft,sent')).toBe(true);
    expect(whereFn).toHaveBeenCalledTimes(1);
  });

  it('classifies a lost race as a conflict, not a success', async () => {
    const { db } = makeDb({ exists: true, rows: [] });
    const outcome = await transitionStatus(db, {
      table,
      id: 'inv-1',
      tenantId: 'tenant-1',
      from: ['draft'],
      to: 'sent',
    });
    expect(outcome).toEqual({ ok: false, reason: 'conflict' });
  });

  it('does not issue an UPDATE for a row that is gone', async () => {
    const { db, set } = makeDb({ exists: false });
    const outcome = await transitionStatus(db, {
      table,
      id: 'inv-1',
      tenantId: 'tenant-1',
      from: ['draft'],
      to: 'sent',
    });
    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
    expect(set).not.toHaveBeenCalled();
  });
});

describe('transitionStatusResponse', () => {
  it('answers 409 for a lost claim and 404 for a gone row', () => {
    const conflict = transitionStatusResponse('Invoice', ['draft'], 'sent', { ok: false, reason: 'conflict' });
    const missing = transitionStatusResponse('Invoice', ['draft'], 'sent', { ok: false, reason: 'not_found' });
    expect(conflict.status).toBe(409);
    expect(missing.status).toBe(404);
  });
});

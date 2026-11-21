/**
 * #3407 — the superadmin template archive write is a transition, not a value.
 * The from-set lives with the entity; a second DELETE on an archived template
 * claims nothing and answers 409 rather than restamping the tombstone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ kind: 'eq', column, value })),
  inArray: vi.fn((column: unknown, values: unknown) => ({ kind: 'inArray', column, values })),
  isNull: vi.fn((column: unknown) => ({ kind: 'isNull', column })),
  and: vi.fn((...parts: unknown[]) => ({ kind: 'and', parts })),
}));
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // Spread the real module first: the registry imports entity modules whose
  // schema files need the rest of drizzle-orm (timestamp, uuid, ...).
  return { ...actual, ...m };
});

import { transitionStatus } from '../../lib/state/transition';
import { allowedFromStatus } from '../../lib/state/transitions';
import { allowedTemplateFromStatus } from '../../lib/templates/transitions';

const columns = {
  id: { name: 'id' },
  status: { name: 'status' },
  deletedAt: { name: 'deleted_at' },
};
const table = { __name: 'product_templates', ...columns };

function makeDb(rows: unknown[]) {
  const set = vi.fn((values: Record<string, unknown>) => ({ values, where: whereFn }));
  const whereFn = vi.fn(() => ({ returning: async () => rows }));
  return { db: { update: vi.fn(() => ({ set })) } as never, set };
}

describe('template archive transition (#3407)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owns the from-set in the entity module and registers it', () => {
    expect(allowedTemplateFromStatus('archived')).toEqual(['active', 'draft']);
    // A target with no declared rule fails closed.
    expect(allowedTemplateFromStatus('active')).toEqual([]);
    expect(allowedFromStatus('productTemplates', 'archived')).toEqual(['active', 'draft']);
  });

  it('claims the from-state and tombstone in the archive UPDATE', async () => {
    const deletedAt = new Date();
    const row = { id: 'tpl-1', status: 'archived' };
    const { db, set } = makeDb([row]);
    const from = allowedFromStatus('productTemplates', 'archived');

    const outcome = await transitionStatus(db, {
      table,
      id: 'tpl-1',
      from,
      to: 'archived',
      patch: { deletedAt },
    });

    expect(outcome).toEqual({ ok: true, row });
    expect(set).toHaveBeenCalledWith({ status: 'archived', deletedAt });
    expect(m.inArray).toHaveBeenCalledWith(columns.status, ['active', 'draft']);
    expect(m.isNull).toHaveBeenCalledWith(columns.deletedAt);
    expect(m.eq).toHaveBeenCalledWith(columns.id, 'tpl-1');
  });

  it('refuses to re-archive: an archived row is not in its own from-set', () => {
    const from = allowedFromStatus('productTemplates', 'archived') as readonly string[];
    expect(from).not.toContain('archived');
  });

  it('classifies a lost archive claim as a conflict', async () => {
    const { db } = makeDb([]);
    const outcome = await transitionStatus(db, {
      table,
      id: 'tpl-1',
      from: allowedFromStatus('productTemplates', 'archived'),
      to: 'archived',
      patch: { deletedAt: new Date() },
    });
    expect(outcome).toEqual({ ok: false, reason: 'conflict' });
  });
});

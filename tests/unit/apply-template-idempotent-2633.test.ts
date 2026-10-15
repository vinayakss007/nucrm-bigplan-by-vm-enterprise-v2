import { describe, it, expect } from 'vitest';
import { applyTemplate, type TemplateBlueprint } from '@/lib/templates/apply-template';
import { pipelines, dealStages, customFieldDefs, automations } from '@/drizzle/schema';
import type { RlsTransaction } from '@/lib/db/rls';

/**
 * #2633 — applyTemplate is the single idempotent materializer. These tests
 * run it against a fake transaction that emulates the four tables it touches
 * (including the two real unique keys: custom field (entityType, fieldKey)
 * and automation (tenant, name) from migration 0129), so the check-then-
 * insert-and-reuse semantics are exercised for real, not string-matched.
 */

type Row = Record<string, unknown>;

/**
 * The builder the fake hands back: chainable on the drizzle methods
 * applyTemplate actually calls, and awaitable because a drizzle query is a
 * thenable. Declaring it is what lets the literal below be typed instead of
 * `any` — the only reason a fake would otherwise need `any`.
 */
interface FakeChain {
  from(table: unknown): FakeChain;
  where(): FakeChain;
  limit(n: number): FakeChain;
  values(v: Row | Row[]): FakeChain;
  onConflictDoNothing(): FakeChain;
  returning(): FakeChain;
  then<T>(onFulfilled: (rows: Row[]) => T, onRejected?: (err: unknown) => T): Promise<T>;
}

interface FakeStore {
  pipelines: Row[];
  dealStages: Row[];
  customFieldDefs: Row[];
  automations: Row[];
}

function makeFakeTx(seed: Partial<FakeStore> = {}) {
  const store: FakeStore = {
    pipelines: seed.pipelines ?? [],
    dealStages: seed.dealStages ?? [],
    customFieldDefs: seed.customFieldDefs ?? [],
    automations: seed.automations ?? [],
  };
  let idSeq = 0;
  const nextId = () => `gen-${++idSeq}`;

  const tableKey = (t: unknown): keyof FakeStore | null => {
    if (t === pipelines) return 'pipelines';
    if (t === dealStages) return 'dealStages';
    if (t === customFieldDefs) return 'customFieldDefs';
    if (t === automations) return 'automations';
    return null;
  };

  const resolve = (pending: () => Row[]): Promise<Row[]> => Promise.resolve().then(pending);

  const makeChain = (key: keyof FakeStore, initial: () => Row[]): FakeChain => {
    let pending = initial;
    let conflictSafe = false;
    const chain: FakeChain = {
      from: (t: unknown) => {
        const k = tableKey(t);
        if (!k) throw new Error(`fake tx: unknown table in from()`);
        return makeChainFrom(k);
      },
      where: () => chain,
      limit: (n: number) => { const p = pending; pending = () => p().slice(0, n); return chain; },
      values: (v: Row | Row[]) => {
        const rows = Array.isArray(v) ? v : [v];
        const prev = pending;
        pending = () => {
          void prev;
          const landed: Row[] = [];
          for (const r of rows) {
            const row: Row = { deletedAt: null, ...r };
            if (conflictSafe) {
              const dup = store[key].some((x) =>
                key === 'automations'
                  ? x.tenantId === row.tenantId && x.name === row.name && !x.deletedAt
                  : x.entityType === row.entityType && x.fieldKey === row.fieldKey && !x.deletedAt);
              if (dup) continue; // onConflictDoNothing → row not returned
            }
            if (row.id === undefined) row.id = nextId();
            if (key === 'dealStages' && row.order === undefined) row.order = 0;
            store[key].push(row);
            landed.push(row);
          }
          return landed;
        };
        return chain;
      },
      onConflictDoNothing: () => { conflictSafe = true; return chain; },
      returning: () => chain,
      then: (res, rej) => resolve(pending).then(res, rej),
    };
    return chain;
  };

  const makeChainFrom = (key: keyof FakeStore) =>
    makeChain(key, () => store[key].filter((r) => !r.deletedAt).map((r) => ({ ...r })));

  const tx = {
    select: () => ({
      from: (t: unknown) => {
        const k = tableKey(t);
        if (!k) throw new Error('fake tx: unknown table in from()');
        return makeChainFrom(k);
      },
    }),
    insert: (t: unknown) => {
      const k = tableKey(t);
      if (!k) throw new Error('fake tx: unknown table in insert()');
      return makeChain(k, () => { throw new Error('fake tx: insert without values()'); });
    },
  } as unknown as RlsTransaction;
  return { tx, store };
}

const BLUEPRINT: TemplateBlueprint = {
  custom_fields: [
    { entity: 'deal', key: 'case_number', label: 'Case Number', type: 'text' },
    { entity: 'contact', key: 'bar_admitted', label: 'Bar Admitted', type: 'date' },
  ],
  pipelines: [
    { name: 'Case Pipeline', stages: ['Consultation', 'Discovery', 'Closed'] },
    { name: 'Client Intake', stages: ['Inquiry', 'Retained'] },
  ],
  automations: [
    { name: 'New case task', trigger: 'deal.created', action: 'create_task', config: { title: 'Open case file' } },
  ],
};

describe('applyTemplate idempotency (#2633)', () => {
  it('first apply creates everything; second apply creates nothing', async () => {
    const { tx, store } = makeFakeTx();
    const opts = { tenantId: 't1', actorUserId: 'u1', blueprint: BLUEPRINT, tx };

    const r1 = await applyTemplate(opts);
    expect(r1.created).toEqual({ pipelines: 2, stages: 5, fields: 2, automations: 1 });
    expect(r1.existing).toEqual({ pipelines: 0, stages: 0, fields: 0, automations: 0 });

    const r2 = await applyTemplate(opts);
    expect(r2.created.pipelines).toBe(0); // the #2633 headline: double-apply made 4 pipelines
    expect(r2.created.stages).toBe(0);
    expect(r2.created.fields).toBe(0);
    expect(r2.created.automations).toBe(0);
    expect(r2.existing.pipelines).toBe(2);
    expect(r2.existing.stages).toBe(5);
    expect(r2.existing.fields).toBe(2);
    expect(r2.existing.automations).toBe(1);

    expect(store.pipelines).toHaveLength(2);
    expect(store.dealStages).toHaveLength(5);
    expect(store.automations).toHaveLength(1);
    expect(store.customFieldDefs).toHaveLength(2);
  });

  it('matches pipeline names case-insensitively', async () => {
    const { tx, store } = makeFakeTx();
    await applyTemplate({ tenantId: 't1', actorUserId: 'u1', blueprint: BLUEPRINT, tx });
    const r = await applyTemplate({
      tenantId: 't1', actorUserId: 'u1', tx,
      blueprint: { pipelines: [{ name: 'CASE PIPELINE', stages: ['consultation'] }], custom_fields: [], automations: [] },
    });
    expect(r.created.pipelines).toBe(0);
    expect(r.created.stages).toBe(0);
    expect(store.pipelines).toHaveLength(2);
  });

  it('appends missing stages at max(order)+1 and never renumbers or deletes existing stages', async () => {
    const { tx, store } = makeFakeTx({
      pipelines: [{ id: 'p1', tenantId: 't1', name: 'Case Pipeline', deletedAt: null }],
      // user dragged: 'closed' first with custom order, plus an extra stage
      dealStages: [
        { id: 's1', tenantId: 't1', pipelineId: 'p1', name: 'Closed', order: 0, deletedAt: null },
        { id: 's2', tenantId: 't1', pipelineId: 'p1', name: 'Discovery', order: 7, deletedAt: null },
        { id: 's3', tenantId: 't1', pipelineId: 'p1', name: 'Custom Stage', order: 9, deletedAt: null },
      ],
    });
    const r = await applyTemplate({
      tenantId: 't1', actorUserId: 'u1', tx,
      blueprint: { pipelines: [{ name: 'Case Pipeline', stages: ['Consultation', 'Discovery', 'Closed'] }] },
    });
    expect(r.created.pipelines).toBe(0);
    expect(r.existing.pipelines).toBe(1);
    expect(r.created.stages).toBe(1); // only Consultation was missing
    expect(r.existing.stages).toBe(2);
    // user rows untouched, new row appended after max(0,7,9)
    const closed = store.dealStages.find((s) => s.id === 's1');
    expect(closed?.order).toBe(0);
    expect(store.dealStages).toHaveLength(4);
    expect(store.dealStages.find((s) => s.name === 'Consultation')?.order).toBe(10);
  });

  it('never deletes rows that exist outside the blueprint', async () => {
    const { tx, store } = makeFakeTx({
      automations: [{ id: 'a0', tenantId: 't1', name: 'User-made automation', deletedAt: null }],
    });
    await applyTemplate({ tenantId: 't1', actorUserId: 'u1', blueprint: BLUEPRINT, tx });
    expect(store.automations.find((a) => a.id === 'a0')).toBeDefined();
    expect(store.automations).toHaveLength(2);
  });

  it('soft-deleted rows do not block re-creation, and an automation name clash lands as existing (0129 unique emulation)', async () => {
    const { tx } = makeFakeTx({
      pipelines: [{ id: 'p1', tenantId: 't1', name: 'Case Pipeline', deletedAt: new Date() }],
      automations: [{ id: 'a1', tenantId: 't1', name: 'New case task', deletedAt: null }],
    });
    const r = await applyTemplate({ tenantId: 't1', actorUserId: 'u1', blueprint: BLUEPRINT, tx });
    expect(r.created.pipelines).toBe(2); // the live 'Case Pipeline' is soft-deleted → recreated
    expect(r.existing.automations).toBe(1);
  });

  it('refuses to run without a transaction (RLS-pinning contract)', async () => {
    await expect(applyTemplate({
      tenantId: 't1', actorUserId: 'u1', blueprint: BLUEPRINT,
      tx: undefined as unknown as RlsTransaction,
    })).rejects.toThrow(/tx is required/);
  });
});

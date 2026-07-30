/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for PATCH/DELETE /api/tenant/pipelines/[id] (#757 item 4).
 *
 * Background: `deals.stage_id` is NOT NULL and references `deal_stages(id)` with
 * ON DELETE no action (drizzle/migrations/0037_flat_sir_ram.sql). The handler
 * used to implement "update stages" as `DELETE FROM deal_stages WHERE
 * pipeline_id = $1` followed by a re-insert, and DELETE only guarded
 * `isDefault`. Both therefore hit a foreign key violation the moment a pipeline
 * actually had deals in it — renaming one stage on a live pipeline returned 500,
 * and so did deleting any non-default pipeline in use.
 *
 * These tests use a local db mock with an ordered queue rather than
 * tests/helpers/db-mock.ts, because that helper resolves every query from one
 * shared resolver and these handlers issue several *different* selects in
 * sequence (existing stages, then the blocking-deal count).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { pipelines, dealStages, deals } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  returningQueue: [] as unknown[][],
  ops: [] as Array<{ op: string; table?: unknown; payload?: unknown }>,
  findFirstPipeline: null as unknown,
}));

vi.mock('@/drizzle/db', () => {
  function reader() {
    const self: any = {
      then: (res: any, rej?: any) =>
        Promise.resolve(h.selectQueue.shift() ?? []).then(res, rej),
    };
    for (const m of ['from', 'where', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'limit', 'offset']) {
      self[m] = () => self;
    }
    return self;
  }

  const db: any = {
    select: () => reader(),
    update: (table: unknown) => {
      const rec: any = { op: 'update', table };
      h.ops.push(rec);
      const chain: any = {
        set: (p: unknown) => {
          rec.payload = p;
          return chain;
        },
        where: () => chain,
        returning: async () => h.returningQueue.shift() ?? [],
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    insert: (table: unknown) => {
      const rec: any = { op: 'insert', table };
      h.ops.push(rec);
      const chain: any = {
        values: (p: unknown) => {
          rec.payload = p;
          return chain;
        },
        returning: async () => h.returningQueue.shift() ?? [],
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    delete: (table: unknown) => {
      const rec: any = { op: 'delete', table };
      h.ops.push(rec);
      const chain: any = {
        where: () => chain,
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    query: { pipelines: { findFirst: async () => h.findFirstPipeline } },
    transaction: async (cb: any) => cb(db),
  };
  return { db };
});

const mockRequireAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: mockRequireAuth }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: mockRateLimit }));

const PIPELINE_ID = '11111111-1111-4111-8111-111111111111';

function req(body?: unknown) {
  return new NextRequest(`http://localhost/api/tenant/pipelines/${PIPELINE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = { params: Promise.resolve({ id: PIPELINE_ID }) };

/** Ops recorded against a given schema table. */
function opsOn(table: unknown) {
  return h.ops.filter((o) => o.table === table);
}

/**
 * Removing a pipeline is a *soft* delete: #860 converted it from
 * db.delete(pipelines) to an update that stamps deletedAt. Asserting on the
 * stamp rather than on a DELETE statement keeps these tests pinned to the
 * behaviour (the row stops being visible) instead of to the mechanism.
 */
function softDeletesOn(table: unknown) {
  return opsOn(table).filter(
    (o) => o.op === 'update' && (o.payload as Record<string, unknown> | undefined)?.['deletedAt'] != null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue = [];
  // updatePipelineSchema is createPipelineSchema.partial(), and `.partial()` does
  // NOT remove `.default()` — so `is_active` always resolves to true and the
  // handler always takes its `tx.update(pipelines).returning()` branch. The
  // `findFirst` fallback beside it is therefore unreachable. See the
  // 'documents the is_active side effect' test below.
  h.returningQueue = [[{ id: PIPELINE_ID, name: 'Pipeline', isDefault: false }]];
  h.ops = [];
  h.findFirstPipeline = null;
  mockRateLimit.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({
    userId: 'u-1',
    tenantId: 't-1',
    isAdmin: true,
    isSuperAdmin: false,
    roleSlug: 'admin',
    permissions: { all: true },
  });
});

describe('PATCH /api/tenant/pipelines/[id] — access control', () => {
  it('rejects a non-admin with 403', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', isAdmin: false });
    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ name: 'X' }), params);
    expect(res.status).toBe(403);
    expect(h.ops).toHaveLength(0);
  });

  it('returns the rate-limit response when throttled', async () => {
    mockRateLimit.mockResolvedValue(NextResponse.json({ error: 'slow down' }, { status: 429 }));
    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ name: 'X' }), params);
    expect(res.status).toBe(429);
    // Throttling must happen before any DB work.
    expect(h.ops).toHaveLength(0);
  });

  it('404s when the pipeline is not in this tenant', async () => {
    h.returningQueue = [[]]; // update matched no row
    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ name: 'Renamed' }), params);
    expect(res.status).toBe(404);
  });
});

describe('PATCH stages — reconciliation instead of delete-and-reinsert', () => {
  const EXISTING = [
    { id: 'stage-a', name: 'Lead' },
    { id: 'stage-b', name: 'Won' },
  ];

  it('renames a stage in place without deleting any stage row', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID, isDefault: false };
    h.selectQueue = [EXISTING];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(
      req({
        stages: [
          { id: 'stage-a', name: 'Qualified', order: 0 },
          { id: 'stage-b', name: 'Won', order: 1 },
        ],
      }),
      params
    );

    expect(res.status).toBe(200);
    // The whole point of the fix: no DELETE on deal_stages, so the FK holds.
    expect(opsOn(dealStages).filter((o) => o.op === 'delete')).toHaveLength(0);
    const updates = opsOn(dealStages).filter((o) => o.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[0]!.payload).toMatchObject({ name: 'Qualified', order: 0 });
    expect(updates[1]!.payload).toMatchObject({ name: 'Won', order: 1 });
  });

  it('does not query blocking deals when nothing is being removed', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [EXISTING];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    await PATCH(
      req({ stages: [{ id: 'stage-a' }, { id: 'stage-b' }] }),
      params
    );
    // Only the "existing stages" select should have been consumed.
    expect(h.selectQueue).toHaveLength(0);
  });

  it('keeps the stored name when the payload omits it (pure reorder)', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [EXISTING];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    await PATCH(
      req({ stages: [{ id: 'stage-b', order: 0 }, { id: 'stage-a', order: 1 }] }),
      params
    );

    const updates = opsOn(dealStages).filter((o) => o.op === 'update');
    // A reorder must not blank the names.
    expect(updates[0]!.payload).toMatchObject({ name: 'Won', order: 0 });
    expect(updates[1]!.payload).toMatchObject({ name: 'Lead', order: 1 });
  });

  it('inserts stages that have no id', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [EXISTING];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    await PATCH(
      req({
        stages: [
          { id: 'stage-a', name: 'Lead' },
          { id: 'stage-b', name: 'Won' },
          { name: 'Negotiation', order: 2 },
        ],
      }),
      params
    );

    const inserts = opsOn(dealStages).filter((o) => o.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toMatchObject({
      tenantId: 't-1',
      pipelineId: PIPELINE_ID,
      name: 'Negotiation',
      order: 2,
    });
  });

  it('accepts `label` as an alias for `name` on new stages', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [EXISTING];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    await PATCH(
      req({ stages: [{ id: 'stage-a' }, { id: 'stage-b' }, { label: 'Renewal' }] }),
      params
    );
    const inserts = opsOn(dealStages).filter((o) => o.op === 'insert');
    expect(inserts[0]!.payload).toMatchObject({ name: 'Renewal' });
  });

  it('deletes a removed stage that holds no deals', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    // existing stages, then the blocking-deal query returning nothing
    h.selectQueue = [EXISTING, []];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ stages: [{ id: 'stage-a', name: 'Lead' }] }), params);

    expect(res.status).toBe(200);
    expect(opsOn(dealStages).filter((o) => o.op === 'delete')).toHaveLength(1);
  });

  it('refuses with 409 when a removed stage still holds deals', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [EXISTING, [{ stageId: 'stage-b', count: 3 }]];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ stages: [{ id: 'stage-a', name: 'Lead' }] }), params);

    // 409, not the 500 the FK violation used to produce.
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('Won');
    expect(json.stages).toEqual(['Won']);
  });

  it('names every blocked stage in the 409', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [
      EXISTING,
      [{ stageId: 'stage-a', count: 1 }, { stageId: 'stage-b', count: 2 }],
    ];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ stages: [{ name: 'Fresh start' }] }), params);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.stages).toEqual(['Lead', 'Won']);
  });

  it('mutates nothing when the removal is refused', async () => {
    h.findFirstPipeline = { id: PIPELINE_ID };
    h.selectQueue = [EXISTING, [{ stageId: 'stage-b', count: 3 }]];

    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    await PATCH(
      req({ stages: [{ id: 'stage-a', name: 'Renamed anyway' }] }),
      params
    );

    // The check runs before any write, so a rejected request leaves the
    // pipeline exactly as it was rather than half-applying the rename.
    expect(opsOn(dealStages)).toHaveLength(0);
  });

  it('leaves stages alone when the payload has no stages key', async () => {
    h.returningQueue = [[{ id: PIPELINE_ID, name: 'Renamed' }]];
    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await PATCH(req({ name: 'Renamed' }), params);

    expect(res.status).toBe(200);
    expect(opsOn(dealStages)).toHaveLength(0);
    expect(opsOn(pipelines).filter((o) => o.op === 'update')).toHaveLength(1);
  });

  it('documents the is_active side effect (pre-existing, not fixed here)', async () => {
    h.selectQueue = [EXISTING];
    const { PATCH } = await import('@/app/api/tenant/pipelines/[id]/route');
    // Body carries only `stages` — no is_active anywhere.
    await PATCH(req({ stages: [{ id: 'stage-a' }, { id: 'stage-b' }] }), params);

    const update = opsOn(pipelines).find((o) => o.op === 'update');
    // Because updatePipelineSchema keeps createPipelineSchema's
    // `.default(true)` through `.partial()`, a stage-only PATCH still writes
    // isActive: true. So editing stages silently re-activates a pipeline that
    // an admin had deactivated. Captured here rather than changed: it is
    // pre-existing and orthogonal to the FK fix, and belongs in its own PR.
    expect(update?.payload).toMatchObject({ isActive: true });
  });
});

describe('DELETE /api/tenant/pipelines/[id]', () => {
  function delReq() {
    return new NextRequest(`http://localhost/api/tenant/pipelines/${PIPELINE_ID}`, {
      method: 'DELETE',
    });
  }

  it('rejects a non-admin with 403', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', isAdmin: false });
    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    expect((await DELETE(delReq(), params)).status).toBe(403);
  });

  it('404s for an unknown pipeline', async () => {
    h.findFirstPipeline = undefined;
    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    expect((await DELETE(delReq(), params)).status).toBe(404);
  });

  it('refuses to delete the default pipeline', async () => {
    h.findFirstPipeline = { isDefault: true };
    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await DELETE(delReq(), params);
    expect(res.status).toBe(400);
    expect(opsOn(pipelines).filter((o) => o.op === 'delete')).toHaveLength(0);
    expect(softDeletesOn(pipelines)).toHaveLength(0);
  });

  it('refuses with 409 when the pipeline still has deals', async () => {
    h.findFirstPipeline = { isDefault: false };
    h.selectQueue = [[{ id: 'stage-a' }, { id: 'stage-b' }], [{ count: 4 }]];

    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await DELETE(delReq(), params);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.dealCount).toBe(4);
    expect(json.error).toContain('4 deals');
    // Must not have removed the pipeline at all, by either mechanism.
    expect(opsOn(pipelines).filter((o) => o.op === 'delete')).toHaveLength(0);
    expect(softDeletesOn(pipelines)).toHaveLength(0);
  });

  it('uses singular wording for a single blocking deal', async () => {
    h.findFirstPipeline = { isDefault: false };
    h.selectQueue = [[{ id: 'stage-a' }], [{ count: 1 }]];

    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    const json = await (await DELETE(delReq(), params)).json();
    expect(json.error).toContain('1 deal (');
  });

  it('deletes a pipeline whose stages hold no deals', async () => {
    h.findFirstPipeline = { isDefault: false };
    h.selectQueue = [[{ id: 'stage-a' }], [{ count: 0 }]];

    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await DELETE(delReq(), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(softDeletesOn(pipelines)).toHaveLength(1);
    // Must not fall back to a hard DELETE, which is what #860 removed.
    expect(opsOn(pipelines).filter((o) => o.op === 'delete')).toHaveLength(0);
  });

  it('deletes a stageless pipeline without running the deal count', async () => {
    h.findFirstPipeline = { isDefault: false };
    h.selectQueue = [[]]; // no stages
    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    const res = await DELETE(delReq(), params);

    expect(res.status).toBe(200);
    expect(h.selectQueue).toHaveLength(0);
    expect(softDeletesOn(pipelines)).toHaveLength(1);
  });

  it('does not touch the deals table when refusing', async () => {
    h.findFirstPipeline = { isDefault: false };
    h.selectQueue = [[{ id: 'stage-a' }], [{ count: 2 }]];
    const { DELETE } = await import('@/app/api/tenant/pipelines/[id]/route');
    await DELETE(delReq(), params);
    expect(opsOn(deals)).toHaveLength(0);
  });
});

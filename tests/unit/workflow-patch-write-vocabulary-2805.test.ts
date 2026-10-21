/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2805 — what `PATCH /api/tenant/workflows/[id]` accepts, measured at the row it
 * writes, so the read-side fix has a documented counterpart.
 *
 * The route answers `GET` with drizzle's camelCase row names
 * (`app/api/tenant/workflows/[id]/route.ts:38`, `:46`, returned untouched at
 * `:58-64`) but *destructures snake_case* on the way in (`:98-105`, `:154-161`).
 * That asymmetry is the whole reason the builder's save payload was right and its
 * read type was wrong: `components/tenant/workflow-builder.tsx:386-401` posts
 * `action_type` / `action_config` / `trigger_type`, which is the request
 * vocabulary, and was then typed as if it were the response.
 *
 * So these tests pin the request side of the round trip: a snake_case body has to
 * land in the camelCase columns, unchanged by this issue.
 *
 * The last two tests record #2806's decision landing. `PATCH` used to never map
 * `trigger_type`, so editing the trigger was silently dropped; the owner picked
 * option (a) — `trigger_type` is the kind (`chk_workflows_trigger_type`'s set:
 * `manual|schedule|event|webhook`) and the dotted event moved to
 * `trigger_config`. The route now maps a legal kind onto `triggerType` and
 * answers any other value with a 400 at the door, so a stray dotted value can
 * never reach the CHECK and surface as a 23514 on save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';
const WF = '44444444-4444-4444-8444-444444444444';

type Row = Record<string, unknown>;
let inserted: Row[] = [];
let updated: Row[] = [];
let deleted = 0;

function recorder() {
  return {
    insert: () => ({ values: (rows: Row | Row[]) => { inserted.push(...(Array.isArray(rows) ? rows : [rows])); return Promise.resolve(inserted); } }),
    delete: () => ({ where: async () => { deleted += 1; } }),
    update: () => ({ set: (values: Row) => { updated.push(values); return { where: async () => [] }; } }),
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(recorder()),
    query: {
      // Only consulted when the caller is activating the workflow.
      workflows: { findFirst: async () => ({ nodes: [] }) },
    },
    select: () => ({ from: () => ({ where: async () => [{ count: 1 }] }) }),
  },
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(), can: () => true };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/with-api-route')>('@/lib/api/with-api-route');
  return { ...actual, withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const { PATCH } = await import('@/app/api/tenant/workflows/[id]/route');

async function patch(body: unknown): Promise<Response> {
  inserted = [];
  updated = [];
  deleted = 0;
  return PATCH(
    new NextRequest(new URL(`/api/tenant/workflows/${WF}`, 'http://localhost:3000'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: WF }) },
  );
}

/** The `workflows` row PATCH wrote, or null when the route skipped the update. */
const workflowRow = (): Row | null => updated.find((r) => 'nodes' in r || 'name' in r || 'status' in r) ?? null;
/** The `workflow_actions` rows PATCH re-inserted. */
const actionRows = (): Row[] => inserted.filter((r) => 'actionType' in r);

beforeEach(() => {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER, tenantId: TENANT, roleSlug: 'admin',
    permissions: { all: true }, isAdmin: true, isSuperAdmin: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the workflows update route takes snake_case and stores camelCase (#2805)', () => {
  it('maps an action body onto the table columns', async () => {
    const res = await patch({
      actions: [
        { action_type: 'send_email', action_config: { subject: 'Welcome' }, condition_config: { field: 'stage' } },
        { action_type: 'create_task', action_config: { title: 'Call them' } },
      ],
    });

    expect(res.status).toBe(200);
    expect(actionRows()).toEqual([
      { workflowId: WF, tenantId: TENANT, orderIndex: 1, actionType: 'send_email', config: { subject: 'Welcome' }, conditionConfig: { field: 'stage' } },
      { workflowId: WF, tenantId: TENANT, orderIndex: 2, actionType: 'create_task', config: { title: 'Call them' }, conditionConfig: {} },
    ]);
  });

  it('replaces the action set rather than appending to it', async () => {
    await patch({ actions: [{ action_type: 'add_tag', action_config: { tag: 'vip' } }] });

    expect(deleted).toBe(1);
    expect(actionRows().length).toBe(1);
  });

  it('writes the canvas and the scalar fields it destructures', async () => {
    const nodes = [{ id: 'trigger-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Trigger', nodeType: 'trigger', config: {} } }];
    const res = await patch({ name: 'Deal onboarding', description: 'two steps', status: 'paused', nodes, trigger_config: { cron: '0 9 * * *' } });

    expect(res.status).toBe(200);
    expect(workflowRow()).toMatchObject({
      name: 'Deal onboarding', description: 'two steps', status: 'paused', nodes,
      triggerConfig: { cron: '0 9 * * *' },
    });
  });

  it('maps trigger_type through the CHECK set instead of dropping it (#2806 a)', async () => {
    // PATCH used to leave trigger_type on the floor: the builder posted one of
    // nine dotted event names and wiring it straight through would have been a
    // 23514 on every save. The owner took #2806's decision — trigger_type is
    // the kind, the event lives in trigger_config — so the route now maps a
    // legal kind onto `triggerType` and rejects anything else with a 400.
    const res = await patch({ name: 'Deal onboarding', trigger_type: 'event', trigger_config: { entity: 'deal', event: 'won' } });

    expect(res.status).toBe(200);
    expect(workflowRow()).toMatchObject({ triggerType: 'event', triggerConfig: { entity: 'deal', event: 'won' } });
  });

  it('answers a dotted or otherwise out-of-set trigger_type with a 400, never a 23514', async () => {
    for (const bad of ['contact.created', 'webhooks', 'WEBHOOK', '']) {
      const res = await patch({ name: 'Deal onboarding', trigger_type: bad });
      expect(res.status, `${JSON.stringify(bad)} must not reach the database`).toBe(400);
    }
    expect(updated).toHaveLength(0);
  });
});

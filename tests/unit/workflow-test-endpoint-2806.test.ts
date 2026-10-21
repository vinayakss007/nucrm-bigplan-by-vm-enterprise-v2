/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2806 — `POST /api/tenant/workflows/[id]/test` now exists at that path.
 *
 * The builder's Test button has always fetched `/workflows/:id/test`, and the
 * only handler lived in `app/api/tenant/workflows/[id]/route.ts`, which Next.js
 * serves at `/workflows/:id`. Every Test press was a 404. The handler moved to
 * `test/route.ts` — and where the old one called `public.execute_workflow()`,
 * a SQL function that only inserts a `'running'` executions row and strands it,
 * the new one runs the same engine `/run` uses, so a test produces a real
 * execution. The entity is optional: the builder has no entity picker yet, and
 * "ran the graph against an empty context" beats "404".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';
const WF = '44444444-4444-4444-8444-444444444444';
const CONTACT = '55555555-5555-4555-8555-555555555555';

type Row = Record<string, unknown>;
let findFirstRow: Row | undefined;
let engineCalls: Row[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      workflows: { findFirst: async () => findFirstRow },
    },
  },
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});

vi.mock('@/lib/automation/workflow-executor', () => ({
  executeWorkflow: async (opts: Row) => {
    engineCalls.push(opts);
    return 'exec-9';
  },
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const { POST } = await import('@/app/api/tenant/workflows/[id]/test/route');

async function test(body: unknown): Promise<{ status: number; json: Row }> {
  const res = await POST(
    new NextRequest(new URL(`/api/tenant/workflows/${WF}/test`, 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id: WF }) },
  );
  return { status: res.status, json: await res.json() as Row };
}

beforeEach(() => {
  findFirstRow = { id: WF, name: 'Welcome flow', status: 'draft' };
  engineCalls = [];
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER, tenantId: TENANT, roleSlug: 'admin',
    permissions: { 'automations.manage': true }, isAdmin: true, isSuperAdmin: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/tenant/workflows/[id]/test (#2806)', () => {
  it('exists at the path the builder posts to, and runs the engine', async () => {
    const { status, json } = await test({});
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, execution_id: 'exec-9' });
    expect(engineCalls).toHaveLength(1);
  });

  it('carries tenant, user, and workflow through, flagged as a test', async () => {
    await test({});
    expect(engineCalls[0]).toMatchObject({
      tenantId: TENANT, userId: USER, workflowId: WF,
      inputData: { test: true },
    });
  });

  it('maps a contact entity onto contactId, not dealId', async () => {
    await test({ trigger_entity_type: 'contact', trigger_entity_id: CONTACT });
    expect(engineCalls[0]).toMatchObject({ contactId: CONTACT, dealId: undefined });
  });

  it('maps a deal entity onto dealId, not contactId', async () => {
    await test({ trigger_entity_type: 'deal', trigger_entity_id: CONTACT });
    expect(engineCalls[0]).toMatchObject({ dealId: CONTACT, contactId: undefined });
  });

  it('leaves both ids unset when the kind carries no entity (schedule/webhook/manual)', async () => {
    await test({ trigger_entity_type: 'schedule' });
    expect(engineCalls[0]).toMatchObject({ contactId: undefined, dealId: undefined });
  });

  it('answers a non-uuid entity id with a 400, not an engine call', async () => {
    const { status } = await test({ trigger_entity_type: 'contact', trigger_entity_id: 'not-a-uuid' });
    expect(status).toBe(400);
    expect(engineCalls).toHaveLength(0);
  });

  it('404s a workflow outside the caller tenant — findFirst is the scope', async () => {
    findFirstRow = undefined;
    const { status } = await test({});
    expect(status).toBe(404);
    expect(engineCalls).toHaveLength(0);
  });

  it('403s without automations.manage', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: USER, tenantId: TENANT, roleSlug: 'viewer',
      permissions: {}, isAdmin: false, isSuperAdmin: false,
    });
    const { status } = await test({});
    expect(status).toBe(403);
  });
});

// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2805 — `components/tenant/workflow-builder.tsx` reads `GET /api/tenant/workflows/[id]`
 * in snake_case, and that route answers with **raw drizzle rows**.
 *
 * `app/api/tenant/workflows/[id]/route.ts:38` and `:46` are
 * `db.query.workflows.findFirst` / `db.query.workflowActions.findMany`, returned
 * untouched at `:58-64` as `{ data: { ...workflow, actions, recentExecutions } }`.
 * Drizzle's TypeScript property names are the camel ones — `triggerType`
 * (`drizzle/schema/automation.ts:71`), `actionType`, `config`, `conditionConfig`
 * (`:94-96`) — the snake_case names exist only as the SQL argument inside the
 * column builder. The client's declared shape (`:40-42` before this fix), whose
 * comment claimed to describe "a persisted workflow action as returned by the
 * workflows API", was describing a payload the route has never sent. And because
 * `res.json()` is `any`, TypeScript could not see the mismatch.
 *
 * What that costs:
 *
 *  - when `nodes` is empty the builder converts `actions` into nodes
 *    (`:243-245`), and `action.action_type.replace(...)` throws. The `catch`
 *    turns it into a toast and leaves the canvas empty, so that workflow cannot
 *    be read at all. `POST /api/tenant/workflows` defaults `nodes = []`
 *    (`app/api/tenant/workflows/route.ts:86`) while still inserting the actions
 *    (`:117-131`), so `{ name, trigger_type, actions }` — the minimal create
 *    payload the endpoint accepts — produces exactly that row.
 *  - `config: action.action_config ?? {}` drops each action's real `config`, so
 *    even on the path that does not throw every node is configured blank.
 *  - `setTriggerType(wf.trigger_type)` assigns `undefined` on **every** open,
 *    and `testWorkflow()` then evaluates `triggerType.split('.')` on it, so Test
 *    fails on a workflow the user has not edited.
 *
 * Each test therefore drives the component over the two seams it actually has —
 * the `fetch` it issues and the body it sends back — with a payload shaped like
 * the route's: drizzle row objects, `nodes: []`, non-empty `actions`. Reading a
 * rendered node out of the canvas is not an option: `@xyflow/react` does not
 * emit `.react-flow__node` elements under jsdom (measured — the classes present
 * are `react-flow__renderer/viewport/nodes` plus the marker defs).
 *
 * The `trigger_type` values below are the four the column can hold:
 * `chk_workflows_trigger_type`
 * (`drizzle/migrations/0050_data_validation_checks.sql:87-88`) admits only
 * `'manual' | 'schedule' | 'event' | 'webhook'`. The builder's `TRIGGER_OPTIONS`
 * (`contact.created`, `deal.won`, …) is a second vocabulary and
 * `createWorkflowSchema`'s `z.enum(['event','schedule','manual'])`
 * (`lib/api/schemas.ts`) a third — and that third is itself narrower than the
 * CHECK it is guarding, omitting `'webhook'`. Which means *creating* a workflow
 * from the builder is a 400 before any of the above is reached. Choosing among
 * the three is a decision about the endpoint's contract, so it is deliberately
 * not folded into this fix; see the follow-up issue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const errorToast = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => errorToast(...args), success: vi.fn() },
}));

import WorkflowBuilder from '@/components/tenant/workflow-builder';

const WORKFLOW_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** A `workflowActions` row as `db.query.workflowActions.findMany` returns it:
 *  drizzle's TypeScript names, not the SQL column names. */
function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    workflowId: WORKFLOW_ID,
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    orderIndex: 1,
    actionType: 'send_email',
    config: { subject: 'Welcome aboard' },
    conditionConfig: {},
    isActive: true,
    ...overrides,
  };
}

/** The body `GET /api/tenant/workflows/[id]` replies with: a `workflows` row
 *  spread, plus `actions` and `recentExecutions` (`[id]/route.ts:58-64`). */
function workflowPayload(actions: unknown[], nodes: unknown[] = [], triggerType = 'event') {
  return {
    data: {
      id: WORKFLOW_ID,
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Deal onboarding',
      description: 'Sends the welcome mail and opens a task',
      status: 'draft',
      triggerType,
      triggerConfig: {},
      nodes,
      edges: [],
      isActive: true,
      isSystem: false,
      actions,
      recentExecutions: [],
    },
  };
}

/** Fetch that answers the builder's GET and records whatever it sends back. */
function stubWorkflowsFetch(payload: unknown) {
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ method, url, body });
    if (method === 'GET') {
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

function loaded(calls: ReturnType<typeof stubWorkflowsFetch>) {
  return waitFor(() => {
    expect(calls.some(c => c.method === 'GET')).toBe(true);
  });
}

beforeEach(() => {
  errorToast.mockClear();
  // @xyflow/react measures every node through ResizeObserver, which jsdom lacks.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('#2805 — the builder reads the payload the workflows route actually sends', () => {
  it('turns actions into nodes that keep their type and their stored config', async () => {
    const calls = stubWorkflowsFetch(workflowPayload([
      actionRow({ orderIndex: 1 }),
      actionRow({
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        orderIndex: 2,
        actionType: 'create_task',
        config: { title: 'Kick off onboarding' },
      }),
    ]));

    render(<WorkflowBuilder workflowId={WORKFLOW_ID} />);
    await loaded(calls);

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const patch = calls.find(c => c.method === 'PATCH');
      expect(patch?.body).toBeTruthy();
      expect((patch!.body as { actions?: unknown[] }).actions).toEqual([
        {
          action_type: 'send_email',
          action_config: { subject: 'Welcome aboard' },
          condition_type: 'always',
          condition_config: {},
        },
        {
          action_type: 'create_task',
          action_config: { title: 'Kick off onboarding' },
          condition_type: 'always',
          condition_config: {},
        },
      ]);
    });
  });

  it('leaves the trigger readable, so Test does not throw on an untouched workflow', async () => {
    const calls = stubWorkflowsFetch(workflowPayload([actionRow()], [], 'event'));

    render(<WorkflowBuilder workflowId={WORKFLOW_ID} />);
    await loaded(calls);

    fireEvent.click(screen.getByRole('button', { name: /^Test$/i }));

    // `testWorkflow()` posts `triggerType.split('.')[0]`. With the state set from
    // `wf.trigger_type` — a key the route never sends — that is
    // `undefined.split` and the request is never made.
    await waitFor(() => {
      const test = calls.find(c => c.method === 'POST' && c.url.endsWith('/test'));
      expect(test?.body).toBeTruthy();
      expect((test!.body as { trigger_entity_type?: string }).trigger_entity_type).toBe('event');
    });
  });

  it('does not report a load failure for a workflow the API can hand back', async () => {
    const calls = stubWorkflowsFetch(workflowPayload([actionRow()]));

    render(<WorkflowBuilder workflowId={WORKFLOW_ID} />);
    await loaded(calls);
    await new Promise(resolve => setTimeout(resolve, 50));

    const reported = errorToast.mock.calls.map(c => String(c[0]));
    expect(reported.filter(m => m.includes('Cannot read properties of undefined'))).toEqual([]);
  });

  it('reads the stored trigger on the nodes-JSONB branch too, not only the converted one', async () => {
    // The branch the builder takes for a workflow it saved itself: `nodes` is
    // populated, so the actions are never converted and the trigger node comes
    // out of the JSONB. Its description is looked up from `wf.triggerType` a
    // second time, at a separate site — the read at the foot of that branch was
    // broken in the same way and is not covered by the tests above.
    const storedNodes = [
      { id: 'trigger-1', type: 'workflowNode', position: { x: 400, y: 50 }, data: { label: 'Trigger', nodeType: 'trigger', config: {} } },
      { id: 'action-1', type: 'workflowNode', position: { x: 400, y: 230 }, data: { label: 'Send Email', nodeType: 'action_send_email', config: { subject: 'Welcome aboard' } } },
    ];
    const calls = stubWorkflowsFetch(workflowPayload([actionRow()], storedNodes, 'schedule'));

    render(<WorkflowBuilder workflowId={WORKFLOW_ID} />);
    await loaded(calls);

    fireEvent.click(screen.getByRole('button', { name: /^Test$/i }));

    await waitFor(() => {
      const test = calls.find(c => c.method === 'POST' && c.url.endsWith('/test'));
      expect((test!.body as { trigger_entity_type?: string }).trigger_entity_type).toBe('schedule');
    });
    const reported = errorToast.mock.calls.map(c => String(c[0]));
    expect(reported.filter(m => /Cannot read properties of undefined/.test(m))).toEqual([]);
  });

  it('keeps the loaded canvas intact when it saves what it was given', async () => {
    const storedNodes = [
      { id: 'trigger-1', type: 'workflowNode', position: { x: 400, y: 50 }, data: { label: 'Trigger', nodeType: 'trigger', config: {} } },
      { id: 'action-1', type: 'workflowNode', position: { x: 400, y: 230 }, data: { label: 'Send Email', nodeType: 'action_send_email', config: { subject: 'Welcome aboard' } } },
    ];
    const calls = stubWorkflowsFetch(workflowPayload([actionRow()], storedNodes, 'event'));

    render(<WorkflowBuilder workflowId={WORKFLOW_ID} />);
    await loaded(calls);

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const patch = calls.find(c => c.method === 'PATCH');
      expect(patch).toBeTruthy();
    });
    const patch = calls.find(c => c.method === 'PATCH')!;
    const body = patch.body as { nodes: unknown[]; actions?: unknown[]; trigger_type?: string };
    expect(body.nodes).toEqual(storedNodes);
    // `nodeType` is the builder's own prefix, so the round trip yields the
    // unprefixed `action_type` the write handlers destructure.
    expect(body.actions).toEqual([
      { action_type: 'send_email', action_config: { subject: 'Welcome aboard' }, condition_type: 'always', condition_config: {} },
    ]);
    // TRIGGER_OPTIONS does not contain 'event' — that gap is the follow-up
    // issue's subject, and this test pins only that the stored value is what
    // reaches the wire.
    expect(body.trigger_type).toBe('event');
  });
});

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3139 — `executeWorkflow` walked the graph, swallowed every action failure
 * into `workflow_execution_logs`, and then unconditionally wrote 'completed'.
 * A run that sent nothing and a run that sent everything were the same row:
 * the history screen (app/api/tenant/workflows/[id]/executions) showed a green
 * execution, and the only evidence of the failure was a log line nobody read.
 *
 * The fix hands each action's outcome up to the walk, so the status is derived
 * from what actually happened. These tests drive the REAL executeWorkflow()
 * through a mocked db (the harness shape from workflow-executor-behavior.test.ts)
 * and assert on the row written to workflow_executions.
 *
 * Two properties hold the change honest:
 *  - the walk must NOT start throwing. An action that fails must still let the
 *    nodes after it run — that swallow is why a bad email cannot roll back a
 *    task that was already created;
 *  - a graph whose actions all succeed must still report 'completed', including
 *    the unknown-action branch, which is a warn-and-continue, not a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn();
const createNotification = vi.fn();
const safeFetch = vi.fn();
const captureError = vi.fn();

vi.mock('@/lib/email/service', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/notifications', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));
vi.mock('@/lib/security/ssrf', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));
vi.mock('@/lib/capture-error', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

vi.mock('@/drizzle/schema', () => ({
  workflows: { id: 'workflows.id', tenantId: 'workflows.tenantId' },
  workflowExecutions: { id: 'workflowExecutions.id' },
  workflowActionLogs: {},
  workflowExecutionLogs: {},
  contacts: { id: 'contacts.id', tenantId: 'contacts.tenantId', tags: 'contacts.tags' },
  deals: { id: 'deals.id', tenantId: 'deals.tenantId' },
  tasks: {},
  callLogs: {},
}));
vi.mock('@/drizzle/relations', () => ({}));
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...c: unknown[]) => ({ __and: c }),
}));

interface DbHarness {
  selectQueue: unknown[][];
  inserts: Array<{ table: unknown; values: Record<string, unknown> }>;
  updates: Array<{ table: unknown; set: Record<string, unknown> }>;
  db: Record<string, unknown>;
}

function makeHarness(): DbHarness {
  const h: DbHarness = { selectQueue: [], inserts: [], updates: [], db: {} };

  const makeInsert = (table: unknown) => () => ({
    values: (vals: Record<string, unknown>) => {
      h.inserts.push({ table, values: vals });
      const p = Promise.resolve([{ id: 'row-1' }]) as Promise<unknown[]> & {
        returning?: () => Promise<unknown[]>;
      };
      p.returning = () => Promise.resolve([{ id: 'exec-1' }]);
      return p;
    },
  });

  const makeUpdate = (table: unknown) => () => ({
    set: (set: Record<string, unknown>) => {
      h.updates.push({ table, set });
      return { where: () => Promise.resolve() };
    },
  });

  const makeSelect = () => () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(h.selectQueue.shift() ?? []) }),
    }),
  });

  const tx = {
    insert: (t: unknown) => makeInsert(t)(),
    update: (t: unknown) => makeUpdate(t)(),
    select: () => makeSelect()(),
  };

  h.db = {
    select: () => makeSelect()(),
    insert: (t: unknown) => makeInsert(t)(),
    update: (t: unknown) => makeUpdate(t)(),
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  return h;
}

let harness: DbHarness;
vi.mock('@/drizzle/db', () => ({ get db() { return harness.db; } }));

type Node = { id: string; type: string; data?: Record<string, unknown> };
type Edge = { id: string; source: string; target: string; sourceHandle?: string };

const trigger: Node = { id: 'trg', type: 'trigger', data: {} };
const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target });

function queueWorkflow(nodes: Node[], edges: Edge[]) {
  harness.selectQueue.push([
    { id: 'wf-1', tenantId: 't-1', name: 'WF', status: 'active', nodes, edges },
  ]);
}

async function run() {
  const { executeWorkflow } = await import('@/lib/automation/workflow-executor');
  return executeWorkflow({ tenantId: 't-1', workflowId: 'wf-1' } as never);
}

/** The row written to workflow_executions when the walk finished. */
function finalStatus(): Record<string, unknown> {
  const writes = harness.updates.filter((u) => 'status' in u.set);
  return writes[writes.length - 1]!.set;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness = makeHarness();
  sendEmail.mockResolvedValue({ success: true, messageId: 'm-1' });
  createNotification.mockResolvedValue(undefined);
  safeFetch.mockResolvedValue({ ok: true });
});

describe('execution status is derived from the actions that ran (#3139)', () => {
  it('reports completed when every action succeeded', async () => {
    queueWorkflow(
      [trigger,
        { id: 'a', type: 'action_send_email', data: { to: 'x@x.test', subject: 'Hi', body: 'Yo' } },
        { id: 'b', type: 'action_create_task', data: { title: 'Follow up' } }],
      [edge('trg', 'a'), edge('a', 'b')],
    );
    await run();
    expect(finalStatus().status).toBe('completed');
    expect(finalStatus().errorMessage).toBeFalsy();
  });

  it('reports failed when an action was recorded as failed, naming the action', async () => {
    // create_deal without stage_id throws inside the action node; on main this
    // run was written as 'completed'.
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_create_deal', data: { title: 'x' } }],
      [edge('trg', 'a')],
    );
    await run();
    const set = finalStatus();
    expect(set.status).toBe('failed');
    expect(set.errorMessage).toContain('create_deal');
    expect(set.errorMessage).toContain('stage_id required');
  });

  it('still runs the nodes after a failure, and reports both', async () => {
    // The swallow is the point: a failed action must not roll back, skip or
    // abort the rest of the graph.
    queueWorkflow(
      [trigger,
        { id: 'a', type: 'action_create_deal', data: { title: 'x' } },
        { id: 'b', type: 'action_create_task', data: { title: 'Still due' } }],
      [edge('trg', 'a'), edge('a', 'b')],
    );
    const id = await run();
    expect(id).toBe('exec-1'); // no throw out of the walk
    expect(harness.inserts.some((i) => (i.values.title as string) === 'Still due')).toBe(true);
    expect(finalStatus().status).toBe('failed');
  });

  it('counts every failure in the message', async () => {
    queueWorkflow(
      [trigger,
        { id: 'a', type: 'action_create_deal', data: {} },
        { id: 'b', type: 'action_send_email', data: { subject: 'x', body: 'y' } }],
      [edge('trg', 'a'), edge('a', 'b')],
    );
    await run();
    expect(finalStatus().errorMessage).toMatch(/^2 action\(s\) failed: /);
  });

  it('keeps the collected context as outputData on a partially failed run', async () => {
    // The run did real work before failing, so the id/input context a reviewer
    // needs to read the failure must still be there.
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_create_deal', data: {} }],
      [edge('trg', 'a')],
    );
    await run();
    expect(finalStatus().outputData).toBeTruthy();
  });

  it('truncates the message so a failing fan-out cannot write an unbounded row', async () => {
    const nodes: Node[] = [trigger];
    const edges: Edge[] = [];
    for (let i = 0; i < 40; i++) {
      const id = `a${i}`;
      nodes.push({ id, type: 'action_create_deal', data: { title: 'x'.repeat(40) } });
      edges.push(i === 0 ? edge('trg', id) : edge(`a${i - 1}`, id));
    }
    queueWorkflow(nodes, edges);
    await run();
    expect((finalStatus().errorMessage as string).length).toBeLessThanOrEqual(500);
  });

  it('an unknown action type is still warn-and-continue, not a failure', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_teleport', data: {} }],
      [edge('trg', 'a')],
    );
    await run();
    expect(finalStatus().status).toBe('completed');
  });

  it('a provider that refuses the send is a failed action, not a completed run', async () => {
    // sendEmail resolves; it never throws (#2422/#3131), so the only way this
    // reaches the collector is the caller gating on result.success.
    sendEmail.mockResolvedValue({ success: false, error: 'relay refused the envelope' });
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_send_email', data: { to: 'x@x.test', subject: 'Hi', body: 'Yo' } }],
      [edge('trg', 'a')],
    );
    await run();
    expect(finalStatus().status).toBe('failed');
    expect(finalStatus().errorMessage).toContain('relay refused the envelope');
  });
});

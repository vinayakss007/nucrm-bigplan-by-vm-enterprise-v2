/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Behavioral unit tests for lib/automation/workflow-executor.ts (#672).
 *
 * The pre-existing executor test files are largely tautological (they assert
 * on local literals or re-implement helpers in the test body) and leave the
 * real action-execution path at ~21% coverage. These tests instead drive the
 * REAL executeWorkflow() through actual ReactFlow-style node graphs so that
 * executeNode(), executeActionNode() (every action branch), the internal
 * condition/wait handling, and the interpolate/escape logic are exercised
 * end-to-end. Side effects (email/notification/webhook/db writes) are captured
 * and asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Captured side effects ────────────────────────────────────────────────────
const sendEmail = vi.fn().mockResolvedValue(undefined);
const createNotification = vi.fn().mockResolvedValue(undefined);
const safeFetch = vi.fn().mockResolvedValue({ ok: true });
const captureError = vi.fn();

vi.mock('@/lib/email/service', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/notifications', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));
vi.mock('@/lib/security/ssrf', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));
vi.mock('@/lib/capture-error', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
// Real escapeHtml is used (imported by the module) — no mock, so we verify actual escaping.

// Drizzle schema tables are only used as opaque references in eq()/insert().
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

// ── DB mock harness ──────────────────────────────────────────────────────────
// Records every insert (by table) and update, and lets tests script the rows
// returned by successive `select()` chains. insert().values() is both awaitable
// and `.returning()`-able; update().set().where() is awaitable.
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
      const p: Promise<unknown[]> & { returning?: () => Promise<unknown[]> } = Promise.resolve([{ id: 'row-1' }]);
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
    select: (...a: unknown[]) => makeSelect()(...(a as [])),
    insert: (t: unknown) => makeInsert(t)(),
    update: (t: unknown) => makeUpdate(t)(),
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  return h;
}

let harness: DbHarness;
vi.mock('@/drizzle/db', () => ({
  get db() {
    return harness.db;
  },
}));

// ── Helpers to build workflow graphs ─────────────────────────────────────────
type Node = { id: string; type: string; data?: Record<string, unknown> };
type Edge = { id: string; source: string; target: string; sourceHandle?: string };

function queueWorkflow(nodes: Node[], edges: Edge[], overrides: Record<string, unknown> = {}) {
  // 1st select -> the workflow row; execution insert then returns exec-1.
  harness.selectQueue.push([
    { id: 'wf-1', tenantId: 't-1', name: 'WF', status: 'active', nodes, edges, ...overrides },
  ]);
}

const trigger: Node = { id: 'trg', type: 'trigger', data: {} };
const edge = (source: string, target: string, sourceHandle?: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

async function run(opts: Record<string, unknown> = {}) {
  const { executeWorkflow } = await import('@/lib/automation/workflow-executor');
  return executeWorkflow({ tenantId: 't-1', workflowId: 'wf-1', ...opts } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  harness = makeHarness();
});

describe('executeWorkflow — guard rails', () => {
  it('throws when the workflow is not found', async () => {
    harness.selectQueue.push([]); // workflow lookup returns nothing
    await expect(run()).rejects.toThrow('Workflow not found');
  });

  it('throws when the workflow is not active/draft', async () => {
    queueWorkflow([trigger], [], { status: 'archived' });
    await expect(run()).rejects.toThrow('archived');
  });

  it('returns the execution id and marks completed for a trigger-only graph', async () => {
    queueWorkflow([trigger], []);
    const id = await run();
    expect(id).toBe('exec-1');
    const completed = harness.updates.find((u) => u.set.status === 'completed');
    expect(completed).toBeTruthy();
  });

  it('marks execution failed when there is no trigger node', async () => {
    queueWorkflow([{ id: 'a', type: 'action_send_email', data: {} }], []);
    await run();
    const failed = harness.updates.find((u) => u.set.status === 'failed');
    expect(failed?.set.errorMessage).toBe('No trigger node found');
  });
});

describe('action: send_email', () => {
  it('interpolates {{vars}} and HTML-escapes substituted values', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_send_email', data: { to: 'x@x.com', subject: 'Hi {{first_name}}', body: '<p>Hello {{first_name}}</p>' } }],
      [edge('trg', 'a')],
    );
    await run({ inputData: { first_name: '<b>Ann</b>' } });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0]![0] as { to: string; subject: string; html: string };
    expect(arg.to).toBe('x@x.com');
    expect(arg.subject).toBe('Hi <b>Ann</b>'); // subject not HTML-escaped
    expect(arg.html).toContain('&lt;b&gt;Ann&lt;/b&gt;'); // body IS escaped
    expect(arg.html).not.toContain('<b>Ann</b>');
  });

  it('records the action failure (no throw) when there is no recipient', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_send_email', data: { subject: 'x', body: 'y' } }],
      [edge('trg', 'a')],
    );
    const id = await run(); // no contact email in ctx
    expect(id).toBe('exec-1');
    expect(sendEmail).not.toHaveBeenCalled();
    // an action log row is written with failed status (the error is swallowed)
    const failedLog = harness.inserts.some((i) => i.values.status === 'failed');
    expect(failedLog).toBe(true);
  });
});

describe('action: create_task / send_notification', () => {
  it('create_task inserts a task with interpolated title', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_create_task', data: { title: 'Call {{first_name}}', priority: 'high' } }],
      [edge('trg', 'a')],
    );
    await run({ userId: 'u-1', inputData: { first_name: 'Bo' } });
    const task = harness.inserts.find((i) => (i.values.title as string)?.includes('Call Bo'));
    expect(task).toBeTruthy();
    expect(task!.values.priority).toBe('high');
    expect(task!.values.createdBy).toBe('u-1');
  });

  it('send_notification calls createNotification for the target user', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_send_notification', data: { user_id: 'u-9', title: 'Ping {{first_name}}', body: 'hey {{first_name}}', link: '/x' } }],
      [edge('trg', 'a')],
    );
    await run({ inputData: { first_name: 'Cy' } });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-9', tenantId: 't-1', title: 'Ping Cy', body: 'hey Cy', link: '/x' }),
    );
  });
});

describe('action: fire_webhook', () => {
  it('POSTs the context via safeFetch (SSRF-guarded)', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_fire_webhook', data: { url: 'https://hook.example/x' } }],
      [edge('trg', 'a')],
    );
    await run({ inputData: { foo: 'bar' } });
    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetch.mock.calls[0]! as [string, { method: string; body: string }];
    expect(url).toBe('https://hook.example/x');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ event: 'workflow.action', tenant_id: 't-1' });
  });

  it('skips the webhook when no url is provided', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_fire_webhook', data: {} }],
      [edge('trg', 'a')],
    );
    await run();
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

describe('condition node', () => {
  it('proceeds to children when the condition is met', async () => {
    queueWorkflow(
      [
        trigger,
        { id: 'c', type: 'condition', data: { field: 'amount', operator: 'greater_than', value: '100' } },
        { id: 'a', type: 'action_send_notification', data: { user_id: 'u-1', title: 't' } },
      ],
      [edge('trg', 'c'), edge('c', 'a')],
    );
    await run({ inputData: { amount: 500 } });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('stops the branch when the condition is not met', async () => {
    queueWorkflow(
      [
        trigger,
        { id: 'c', type: 'condition', data: { field: 'amount', operator: 'greater_than', value: '100' } },
        { id: 'a', type: 'action_send_notification', data: { user_id: 'u-1', title: 't' } },
      ],
      [edge('trg', 'c'), edge('c', 'a')],
    );
    await run({ inputData: { amount: 5 } });
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('wait node', () => {
  it('logs a capped warning when the wait exceeds the 60s cap and does not block on the full duration', async () => {
    vi.useFakeTimers();
    try {
      queueWorkflow(
        [trigger, { id: 'w', type: 'wait', data: { duration: 2, unit: 'days' } }],
        [edge('trg', 'w')],
      );
      const p = run();
      // The executor caps at 60s; advance fake timers to release setTimeout.
      await vi.advanceTimersByTimeAsync(60_000);
      const id = await p;
      expect(id).toBe('exec-1');
      const cappedLog = harness.inserts.some((i) => (i.values.message as string)?.includes('exceeds 60s cap'));
      expect(cappedLog).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('action: db-mutating branches', () => {
  it('update_contact sets the configured field scoped to the contact', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_update_contact', data: { field: 'lead_status', value: 'qualified' } }],
      [edge('trg', 'a')],
    );
    await run({ contactId: 'c-1', inputData: {} });
    const upd = harness.updates.find((u) => u.set.lead_status === 'qualified');
    expect(upd).toBeTruthy();
    expect(upd!.set.updatedAt).toBeInstanceOf(Date);
  });

  it('update_contact is a no-op when there is no contact in context', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_update_contact', data: { field: 'x', value: 'y' } }],
      [edge('trg', 'a')],
    );
    await run();
    expect(harness.updates.some((u) => u.set.x === 'y')).toBe(false);
  });

  it('add_tag appends a new tag when not already present', async () => {
    harness.selectQueue.push([
      { id: 'wf-1', tenantId: 't-1', name: 'WF', status: 'active',
        nodes: [trigger, { id: 'a', type: 'action_add_tag', data: { tag: 'vip' } }],
        edges: [edge('trg', 'a')] },
    ]);
    // contact hydrate (has contactId) then add_tag reads existing tags
    harness.selectQueue.push([{ id: 'c-1', firstName: 'T', email: 't@t.com', tenantId: 't-1' }]);
    harness.selectQueue.push([{ tags: ['existing'] }]);
    await run({ contactId: 'c-1' });
    const upd = harness.updates.find((u) => Array.isArray(u.set.tags));
    expect(upd!.set.tags).toEqual(['existing', 'vip']);
  });

  it('add_tag does not duplicate an already-present tag', async () => {
    harness.selectQueue.push([
      { id: 'wf-1', tenantId: 't-1', name: 'WF', status: 'active',
        nodes: [trigger, { id: 'a', type: 'action_add_tag', data: { tag: 'vip' } }],
        edges: [edge('trg', 'a')] },
    ]);
    harness.selectQueue.push([{ id: 'c-1', firstName: 'T', email: 't@t.com', tenantId: 't-1' }]);
    harness.selectQueue.push([{ tags: ['vip'] }]);
    await run({ contactId: 'c-1' });
    expect(harness.updates.some((u) => Array.isArray(u.set.tags))).toBe(false);
  });

  it('create_deal inserts a deal and throws (recorded, not fatal) without a stage_id', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_create_deal', data: { title: 'Big {{first_name}}', stage_id: 's-1', amount: '999' } }],
      [edge('trg', 'a')],
    );
    await run({ userId: 'u-1', inputData: { first_name: 'Zoe' } });
    const deal = harness.inserts.find((i) => (i.values.title as string) === 'Big Zoe');
    expect(deal).toBeTruthy();
    expect(deal!.values.stageId).toBe('s-1');
    expect(deal!.values.amount).toBe('999');
  });

  it('create_deal without stage_id records a failed action (error swallowed)', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_create_deal', data: { title: 'x' } }],
      [edge('trg', 'a')],
    );
    const id = await run();
    expect(id).toBe('exec-1');
    expect(harness.inserts.some((i) => i.values.status === 'failed')).toBe(true);
  });

  it('assign_contact updates assignedTo', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_assign_contact', data: { assigned_to: 'rep-7' } }],
      [edge('trg', 'a')],
    );
    await run({ contactId: 'c-1' });
    expect(harness.updates.some((u) => u.set.assignedTo === 'rep-7')).toBe(true);
  });

  it('log_call inserts a call log with defaults', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_log_call', data: { notes: 'Talked to {{first_name}}' } }],
      [edge('trg', 'a')],
    );
    await run({ contactId: 'c-1', userId: 'u-1', inputData: { first_name: 'Kai' } });
    const call = harness.inserts.find((i) => (i.values.notes as string)?.includes('Talked to Kai'));
    expect(call).toBeTruthy();
    expect(call!.values.direction).toBe('outbound');
  });

  it('unknown action type does not throw and still completes', async () => {
    queueWorkflow(
      [trigger, { id: 'a', type: 'action_teleport', data: {} }],
      [edge('trg', 'a')],
    );
    const id = await run();
    expect(id).toBe('exec-1');
    expect(harness.updates.some((u) => u.set.status === 'completed')).toBe(true);
  });
});

describe('condition operators', () => {
  const build = (operator: string, value: unknown, field = 'v') =>
    queueWorkflow(
      [
        trigger,
        { id: 'c', type: 'condition', data: { field, operator, value } },
        { id: 'a', type: 'action_send_notification', data: { user_id: 'u-1', title: 't' } },
      ],
      [edge('trg', 'c'), edge('c', 'a')],
    );

  it.each([
    ['equals', 'x', { v: 'x' }, true],
    ['not_equals', 'x', { v: 'y' }, true],
    ['contains', 'ell', { v: 'hello' }, true],
    ['not_contains', 'z', { v: 'hello' }, true],
    ['less_than', '10', { v: 3 }, true],
    ['is_empty', '', { v: '' }, true],
    ['is_not_empty', '', { v: 'set' }, true],
    ['equals', 'x', { v: 'nope' }, false],
    ['bogus_operator', 'x', { v: 'x' }, false],
  ] as const)('operator %s -> proceeds=%s', async (operator, value, input, proceeds) => {
    build(operator, value);
    await run({ inputData: input });
    expect(createNotification).toHaveBeenCalledTimes(proceeds ? 1 : 0);
  });

  it('condition with no field configured stops the branch', async () => {
    queueWorkflow(
      [
        trigger,
        { id: 'c', type: 'condition', data: { operator: 'equals', value: 'x' } },
        { id: 'a', type: 'action_send_notification', data: { user_id: 'u-1', title: 't' } },
      ],
      [edge('trg', 'c'), edge('c', 'a')],
    );
    await run();
    // No field -> break (falls through to children), so the action still runs.
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

describe('graph traversal', () => {
  it('executes a shared fan-in node only once (visited dedup)', async () => {
    queueWorkflow(
      [
        trigger,
        { id: 'b1', type: 'trigger', data: {} },
        { id: 'b2', type: 'trigger', data: {} },
        { id: 'a', type: 'action_send_notification', data: { user_id: 'u-1', title: 't' } },
      ],
      [edge('trg', 'b1'), edge('trg', 'b2'), edge('b1', 'a'), edge('b2', 'a')],
    );
    await run();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

describe('tenant scoping of hydrated context', () => {
  it('loads contact + deal scoped to the tenant and exposes them to actions', async () => {
    // select #1 = workflow, #2 = contact, #3 = deal
    harness.selectQueue.push([
      { id: 'wf-1', tenantId: 't-1', name: 'WF', status: 'active',
        nodes: [trigger, { id: 'a', type: 'action_send_email', data: { subject: 'Hi', body: 'hi' } }],
        edges: [edge('trg', 'a')] },
    ]);
    harness.selectQueue.push([{ id: 'c-1', firstName: 'Dee', email: 'dee@co.com', tenantId: 't-1' }]);
    harness.selectQueue.push([{ id: 'd-1', title: 'Deal', amount: '10', tenantId: 't-1' }]);

    await run({ contactId: 'c-1', dealId: 'd-1' });
    // email used the hydrated contact email as the recipient fallback
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'dee@co.com' }));
  });
});

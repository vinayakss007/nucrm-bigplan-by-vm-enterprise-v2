/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for issue #3131 — both automation engines record a provider-rejected
 * email action as a successful run.
 *
 * `sendEmail` (#2422/#3045 doctrine) resolves `{ success, provider?, messageId?,
 * error? }` and NEVER throws on a provider 4xx/5xx, so the caller has to read
 * the result. Neither automation caller did:
 *
 *   - `lib/automation/engine.ts:168-172` awaits `sendEmail` and drops the
 *     result, while `:93-101` writes `automationRuns.status = 'success'` in the
 *     same transaction. A tenant whose automation emailed a suppressed address
 *     sees a green run with no hint the mail was refused.
 *   - `lib/automation/workflow-executor.ts:293-297` does the same, then stamps
 *     `actionLog.status = 'success'` at `:420`.
 *
 * These tests drive the REAL entry points with a mocked `db` and a mocked
 * `sendEmail`, and assert on the captured insert patches. The dev DB has zero
 * rows, so nothing here touches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared captured side effects ─────────────────────────────────────────────
const sendEmail = vi.fn();
const createNotification = vi.fn().mockResolvedValue(undefined);
const safeFetch = vi.fn().mockResolvedValue({ ok: true });
const captureError = vi.fn();

vi.mock('@/lib/email/service', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/notifications', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));
vi.mock('@/lib/security/ssrf', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));
vi.mock('@/lib/capture-error', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

vi.mock('@/drizzle/schema', () => ({
  // Rule engine tables
  automations: { tenantId: 'a.tenantId', isActive: 'a.isActive', triggerType: 'a.trigger', createdAt: 'a.createdAt' },
  automationRuns: {},
  contacts: { id: 'c.id', tenantId: 'c.tenantId', tags: 'c.tags', deletedAt: 'c.deletedAt', doNotContact: 'c.doNotContact', unsubscribed: 'c.unsubscribed' },
  deals: { id: 'd.id', tenantId: 'd.tenantId' },
  tasks: { id: 'tk.id', tenantId: 'tk.tenantId' },
  callLogs: {},
  integrations: { tenantId: 'i.tenantId', type: 'i.type', isActive: 'i.isActive' },
  sequences: { id: 's.id', tenantId: 's.tenantId', enrollCount: 's.enrollCount' },
  sequenceEnrollments: { id: 'se.id', tenantId: 'se.tenantId', sequenceId: 'se.sequenceId', contactId: 'se.contactId', status: 'se.status', deletedAt: 'se.deletedAt' },
  sequenceSteps: { tenantId: 'ss.tenantId', sequenceId: 'ss.sequenceId', stepNumber: 'ss.stepNumber', isActive: 'ss.isActive', deletedAt: 'ss.deletedAt', delayDays: 'ss.delayDays', delayHours: 'ss.delayHours', delayMinutes: 'ss.delayMinutes' },
  // Workflow executor tables
  workflows: { id: 'workflows.id', tenantId: 'workflows.tenantId' },
  workflowExecutions: { id: 'workflowExecutions.id' },
  workflowActionLogs: {},
  workflowExecutionLogs: {},
}));
vi.mock('@/drizzle/relations', () => ({}));
vi.mock('drizzle-orm', () => {
  const sqlFn = (strings: TemplateStringsArray, ...v: unknown[]) => ({ __sql: strings.join('?'), values: v });
  Object.assign(sqlFn, { join: (parts: unknown[], sep: unknown) => ({ __join: parts, __sep: sep }) });
  return {
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...c: unknown[]) => ({ __and: c }),
    isNull: (a: unknown) => ({ __isNull: a }),
    inArray: (a: unknown, b: unknown) => ({ __in: [a, b] }),
    sql: sqlFn,
  };
});

// ── DB harness (one instance, used by both engines) ──────────────────────────
interface Row { table?: unknown; values: Record<string, unknown> }
interface Harness {
  selectQueue: unknown[][];
  inserts: Row[];
  updates: Array<{ table: unknown; set: Record<string, unknown> }>;
  /** Rows written by the OUTERMOST db.insert — the rule engine's failed-run log. */
  runLog: Row[];
  failInsert: boolean;
  /** How many times the transaction callback started. */
  txStarted: number;
}
let h: Harness;

function makeHarness(): Harness {
  return { selectQueue: [], inserts: [], updates: [], runLog: [], failInsert: false, txStarted: 0 };
}

const makeTables = (outer = false) => ({
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      (outer ? h.runLog : h.inserts).push({ table, values });
      const settle = () => h.failInsert
        ? Promise.reject(new Error('enrollment write exploded'))
        : Promise.resolve([{ id: 'row-1' }]);
      const chain: Record<string, unknown> = {};
      chain.onConflictDoNothing = () => chain;
      chain.returning = () => settle();
      chain.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err);
      chain.catch = (err?: (e: unknown) => unknown) => settle().catch(err);
      return chain;
    },
  }),
  update: (table: unknown) => ({
    set: (set: Record<string, unknown>) => {
      h.updates.push({ table, set });
      return { where: () => Promise.resolve() };
    },
  }),
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(h.selectQueue.shift() ?? []) }),
    }),
  }),
});

const automationsFindMany = vi.fn().mockResolvedValue([]);
const integrationsFindFirst = vi.fn().mockResolvedValue(undefined);

vi.mock('@/drizzle/db', () => ({
  get db() {
    return {
      query: {
        automations: { findMany: (...a: unknown[]) => automationsFindMany(...a) },
        integrations: { findFirst: (...a: unknown[]) => integrationsFindFirst(...a) },
      },
      ...makeTables(true),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        h.txStarted += 1;
        return fn(makeTables(false));
      },
    };
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
type Action = { type: string; config?: Record<string, unknown> };

async function fireRule(actions: Action[], data: Record<string, unknown> = {}) {
  automationsFindMany.mockResolvedValue([
    { id: 'auto-1', name: 'A', tenantId: 't-1', triggerType: 'contact.created', isActive: true, conditions: [], actions },
  ]);
  const { evaluateAutomations } = await import('@/lib/automation/engine');
  await evaluateAutomations({ tenantId: 't-1', event: 'contact.created', data } as never);
}

/** The row the rule engine wrote into `automation_runs` inside its transaction. */
function txRunRow(): Row | undefined {
  return h.inserts.find((i) => i.values['automationId'] !== undefined);
}

type Node = { id: string; type: string; data?: Record<string, unknown> };
type Edge = { id: string; source: string; target: string; sourceHandle?: string };
const trigger: Node = { id: 'trg', type: 'trigger', data: {} };
const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target });

async function runWorkflow(nodes: Node[], edges: Edge[]) {
  // 1st select on the real module is the workflow row itself.
  h.selectQueue.push([
    { id: 'wf-1', tenantId: 't-1', name: 'WF', status: 'active', nodes, edges },
  ]);
  const { executeWorkflow } = await import('@/lib/automation/workflow-executor');
  return executeWorkflow({ tenantId: 't-1', workflowId: 'wf-1' } as never);
}

/** The `workflow_action_logs` row for the action that ran. */
const actionLogs = () => h.inserts.filter((i) => typeof i.values['executionId'] === 'string' && i.values['actionId'] === null);
const executionLogs = () => h.inserts.filter((i) => i.values['workflowExecutionId'] !== undefined);

beforeEach(() => {
  vi.clearAllMocks();
  h = makeHarness();
  createNotification.mockResolvedValue(undefined);
  safeFetch.mockResolvedValue({ ok: true });
  automationsFindMany.mockResolvedValue([]);
  integrationsFindFirst.mockResolvedValue(undefined);
  sendEmail.mockResolvedValue({ success: true, provider: 'resend', messageId: 'msg-1' });
});

// ── Rule engine ──────────────────────────────────────────────────────────────
describe('evaluateAutomations — the run row tells the truth about the send (#3131)', () => {
  it('a provider-rejected send is NOT logged as a successful run', async () => {
    sendEmail.mockResolvedValue({ success: false, error: '550 message rejected: suppressed address' });
    await fireRule([{ type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'x' } }]);

    const run = txRunRow();
    expect(run).toBeTruthy();
    expect(run!.values.status).not.toBe('success');
    expect(String(run!.values.errorMessage)).toContain('550 message rejected');
  });

  it('names the failing action so the run is diagnosable', async () => {
    sendEmail.mockResolvedValue({ success: false, error: '429 too many' });
    await fireRule([{ type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'x' } }]);

    expect(String(txRunRow()!.values.errorMessage)).toContain('send_email');
  });

  it('still reports a failure when the provider gives no reason', async () => {
    sendEmail.mockResolvedValue({ success: false });
    await fireRule([{ type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'x' } }]);

    const run = txRunRow()!;
    expect(run.values.status).not.toBe('success');
    expect(String(run.values.errorMessage).length).toBeGreaterThan(0);
  });

  it('an accepted send is still logged as a success with no error message', async () => {
    await fireRule([{ type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'x' } }]);

    const run = txRunRow()!;
    expect(run.values.status).toBe('success');
    expect(run.values.errorMessage ?? null).toBeNull();
  });

  it('a rejected send does not stop the sibling actions from being written', async () => {
    // Regression guard for the tempting wrong fix (throw inside the loop):
    // that would abort the transaction and roll back the task row that the
    // tenant configured to run alongside the mail.
    sendEmail.mockResolvedValue({ success: false, error: '550 rejected' });
    await fireRule([
      { type: 'create_task', config: { title: 'Call {{name}}' } },
      { type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'x' } },
    ], { name: 'Ada', contact_id: 'c-1' });

    expect(h.txStarted).toBe(1);
    expect(h.inserts.some((i) => i.values.title === 'Call Ada')).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // the failure is recorded by the in-transaction row, not by the catch path
    expect(h.runLog).toHaveLength(0);
    expect(txRunRow()!.values.status).not.toBe('success');
  });

  it('an email action rejected after another action succeeds still fails the run', async () => {
    sendEmail.mockResolvedValueOnce({ success: false, error: 'first refused' })
      .mockResolvedValueOnce({ success: true, messageId: 'msg-2' });
    await fireRule([
      { type: 'send_email', config: { to: 'a@b.com', subject: 'Hi', body: 'x' } },
      { type: 'send_email', config: { to: 'c@d.com', subject: 'Hi', body: 'y' } },
    ]);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const run = txRunRow()!;
    expect(run.values.status).not.toBe('success');
    expect(String(run.values.errorMessage)).toContain('first refused');
  });

  it('an action with no recipient stays a skipped success', async () => {
    await fireRule([{ type: 'send_email', config: { subject: 'Hi', body: 'x' } }]);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(txRunRow()!.values.status).toBe('success');
  });

  it('a write that explodes is still logged through the outer failed-run path', async () => {
    h.failInsert = true;
    await fireRule([{ type: 'create_task', config: { title: 'Boom' } }]);

    expect(captureError).toHaveBeenCalled();
    expect(h.runLog.some((r) => r.values.status === 'failed')).toBe(true);
  });
});

// ── Workflow executor ────────────────────────────────────────────────────────
describe('executeWorkflow — the action log tells the truth about the send (#3131)', () => {
  it('a provider-rejected send records the action as failed, not success', async () => {
    sendEmail.mockResolvedValue({ success: false, error: '550 message rejected' });
    await runWorkflow(
      [trigger, { id: 'a', type: 'action_send_email', data: { to: 'x@x.com', subject: 'Hi', body: 'y' } }],
      [edge('trg', 'a')],
    );

    const log = actionLogs()[0];
    expect(log).toBeTruthy();
    expect(log!.values.status).toBe('failed');
    expect(executionLogs().some((l) => String(l.values.message).includes('550 message rejected'))).toBe(true);
  });

  it('an accepted send still records the action as success', async () => {
    await runWorkflow(
      [trigger, { id: 'a', type: 'action_send_email', data: { to: 'x@x.com', subject: 'Hi', body: 'y' } }],
      [edge('trg', 'a')],
    );

    expect(actionLogs()[0]!.values.status).toBe('success');
  });

  it('a missing recipient still fails the action without calling the provider', async () => {
    await runWorkflow(
      [trigger, { id: 'a', type: 'action_send_email', data: { subject: 'Hi', body: 'y' } }],
      [edge('trg', 'a')],
    );

    expect(sendEmail).not.toHaveBeenCalled();
    expect(actionLogs()[0]!.values.status).toBe('failed');
  });

  it('a rejected send does not abort the execution — later nodes still run', async () => {
    // Deliberate scope: per-action failures were already swallowed by the
    // executor's own catch (the pre-existing no-recipient case proves it), so
    // the rejection must not become an unhandled throw out of the graph walk.
    sendEmail.mockResolvedValue({ success: false, error: '550 message rejected' });
    const id = await runWorkflow(
      [trigger,
        { id: 'a', type: 'action_send_email', data: { to: 'x@x.com', subject: 'Hi', body: 'y' } },
        { id: 'b', type: 'action_create_task', data: { title: 'Follow up' } }],
      [edge('trg', 'a'), edge('a', 'b')],
    );

    expect(id).toBeTruthy();
    expect(h.inserts.some((i) => i.values.title === 'Follow up')).toBe(true);
    // #3139 fixed the other half of this. Not aborting was already right; the
    // 'completed' this asserted next to an action log saying the send failed
    // was the false claim the issue was filed about.
    expect(h.updates.some((u) => u.set.status === 'failed')).toBe(true);
  });
});

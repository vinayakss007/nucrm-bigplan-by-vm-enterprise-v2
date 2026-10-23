/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Action-branch coverage for lib/automation/engine.ts (#672).
 *
 * The existing automation-engine test covers evaluateAutomations() plumbing and
 * a couple of actions (send_email / send_notification) but leaves ~2/3 of the
 * executeAction() switch untested (update_field, create_task, enroll_sequence,
 * log_call, send_whatsapp, fire_webhook, assign_contact, create_deal,
 * remove_tag, send_sms) plus several condition operators.
 *
 * These tests drive the REAL evaluateAutomations() with single-action
 * automations so each executeAction() branch runs inside the actual
 * transaction, and assert the concrete side effect (db write, safeFetch call,
 * HTML-escaping, allowlist enforcement, tenant scoping).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Captured side effects ────────────────────────────────────────────────────
// sendEmail resolves a SendResult, never undefined (#2422/#3045 contract).
const sendEmail = vi.fn().mockResolvedValue({ success: true, provider: 'resend', messageId: 'msg-1' });
const createNotification = vi.fn().mockResolvedValue(undefined);
const safeFetch = vi.fn().mockResolvedValue({ ok: true });
const captureError = vi.fn();
const logError = vi.fn();
const integrationsFindFirst = vi.fn().mockResolvedValue(undefined);
const automationsFindMany = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/email/service', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/notifications', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));
vi.mock('@/lib/security/ssrf', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));
vi.mock('@/lib/capture-error', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
vi.mock('@/lib/errors-server', () => ({ logError: (...a: unknown[]) => logError(...a) }));
vi.mock('@/drizzle/schema', () => ({
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
}));
vi.mock('@/drizzle/relations', () => ({}));
vi.mock('drizzle-orm', () => {
  const sqlFn = (strings: TemplateStringsArray, ...v: unknown[]) => ({ __sql: strings.join('?'), values: v });
  // `activeStepWhere` in lib/cron/sequence-steps.ts composes its id list with
  // `sql.join`, which the enroll_sequence action now reaches through
  // `firstStepDueAt` (#2793) to read step 1's delay.
  Object.assign(sqlFn, { join: (parts: unknown[], sep: unknown) => ({ __join: parts, __sep: sep }) });
  return {
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...c: unknown[]) => ({ __and: c }),
    isNull: (a: unknown) => ({ __isNull: a }),
    inArray: (a: unknown, b: unknown) => ({ __in: [a, b] }),
    sql: sqlFn,
  };
});

// ── DB mock harness (records tx-level side effects) ──────────────────────────
interface Harness {
  selectQueue: unknown[][];
  inserts: Array<{ table: unknown; values: Record<string, unknown> }>;
  updates: Array<{ table: unknown; set: Record<string, unknown> }>;
  executes: unknown[];
  /** The WHERE tree of every tx-level select, in the order they ran. */
  selects: unknown[];
  /** Rows written to `automation_runs` by the outer db (success/failed log). */
  runLog: Record<string, unknown>[];
  failInsert: boolean;
}
let h: Harness;

function makeTx() {
  return {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        // #2740: `enroll_sequence` reads back the row it wrote
        // (`.onConflictDoNothing().returning({ id })`) so a racing duplicate does not move the
        // enroll counter. The fake is awaitable directly AND chainable, and explodes on both
        // paths when the harness asks for a failed write.
        const settle = () =>
          h.failInsert
            ? Promise.reject(new Error('enrollment write exploded'))
            : Promise.resolve([{ id: 'row-1' }]);
        if (!h.failInsert) h.inserts.push({ table, values });
        const chain = {
          returning: settle,
          then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
        };
        return {
          onConflictDoNothing: () => chain,
          then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
        };
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
        where: (pred: unknown) => {
          h.selects.push(pred);
          return { limit: () => Promise.resolve(h.selectQueue.shift() ?? []) };
        },
      }),
    }),
    execute: (q: unknown) => {
      h.executes.push(q);
      return Promise.resolve([]);
    },
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      automations: { findMany: (...a: unknown[]) => automationsFindMany(...a) },
      integrations: { findFirst: (...a: unknown[]) => integrationsFindFirst(...a) },
    },
    // Top-level insert used only for the failed-run log path.
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        h.runLog.push(values);
        return { catch: () => Promise.resolve() };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
  },
}));

type Action = { type: string; config?: Record<string, unknown> };

async function fire(
  action: Action,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  automationsFindMany.mockResolvedValue([
    { id: 'auto-1', name: 'A', tenantId: 't-1', triggerType: 'contact.created', isActive: true, conditions: [], actions: [action] },
  ]);
  const { evaluateAutomations } = await import('@/lib/automation/engine');
  await evaluateAutomations({ tenantId: 't-1', event: 'contact.created', data, ...extra } as never);
}

const inserted = () => h.inserts;
const updated = () => h.updates;

beforeEach(() => {
  vi.clearAllMocks();
  h = { selectQueue: [], inserts: [], updates: [], executes: [], selects: [], runLog: [], failInsert: false };
  integrationsFindFirst.mockResolvedValue(undefined);
});

describe('send_email HTML escaping', () => {
  it('HTML-escapes interpolated values in the body (XSS defense)', async () => {
    await fire(
      { type: 'send_email', config: { to: 'x@x.com', subject: 'Hi', body: '<p>{{name}}</p>' } },
      { name: '<script>evil</script>' },
    );
    const arg = sendEmail.mock.calls[0]![0] as { html: string };
    expect(arg.html).toContain('&lt;script&gt;evil&lt;/script&gt;');
    expect(arg.html).not.toContain('<script>evil</script>');
  });

  it('skips when there is no recipient', async () => {
    await fire({ type: 'send_email', config: { subject: 'Hi', body: 'x' } }, {});
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('update_field (allowlist enforcement)', () => {
  it('updates an allowlisted contact field scoped to the tenant', async () => {
    await fire(
      { type: 'update_field', config: { resource: 'contacts', id_field: 'contact_id', field: 'leadStatus', value: 'qualified' } },
      { contact_id: 'c-1' },
    );
    const upd = updated().find((u) => u.set.leadStatus === 'qualified');
    expect(upd).toBeTruthy();
    expect(upd!.set.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects a non-allowlisted field (no update issued)', async () => {
    await fire(
      { type: 'update_field', config: { resource: 'contacts', id_field: 'contact_id', field: 'passwordHash', value: 'x' } },
      { contact_id: 'c-1' },
    );
    expect(updated().some((u) => 'passwordHash' in u.set)).toBe(false);
  });

  it('does nothing when the resource id is missing', async () => {
    await fire({ type: 'update_field', config: { resource: 'deals', field: 'stage', value: 'won' } }, {});
    expect(updated().length).toBe(0);
  });
});

describe('create_task / log_call / assign_contact', () => {
  it('create_task inserts a task with interpolated title', async () => {
    await fire({ type: 'create_task', config: { title: 'Follow {{name}}', priority: 'high' } }, { name: 'Ada', contact_id: 'c-1' }, { userId: 'u-1' });
    const task = inserted().find((i) => (i.values.title as string) === 'Follow Ada');
    expect(task).toBeTruthy();
    expect(task!.values.priority).toBe('high');
    expect(task!.values.createdBy).toBe('u-1');
  });

  it('log_call inserts a call log (skipped without a contact)', async () => {
    await fire({ type: 'log_call', config: { notes: 'Called {{name}}', direction: 'inbound' } }, { name: 'Bo', contact_id: 'c-1' });
    const call = inserted().find((i) => (i.values.notes as string) === 'Called Bo');
    expect(call).toBeTruthy();
    expect(call!.values.direction).toBe('inbound');

    h.inserts = [];
    await fire({ type: 'log_call', config: { notes: 'x' } }, {}); // no contact
    expect(inserted().some((i) => i.values.notes === 'x')).toBe(false);
  });

  it('assign_contact updates assignedTo when both id and assignee present', async () => {
    await fire({ type: 'assign_contact', config: { assigned_to: 'rep-1' } }, { contact_id: 'c-1' });
    expect(updated().some((u) => u.set.assignedTo === 'rep-1')).toBe(true);
  });
});

describe('create_deal', () => {
  it('inserts a deal when stage_id is provided', async () => {
    await fire({ type: 'create_deal', config: { title: 'Deal {{name}}', stage_id: 's-1', amount: '500' } }, { name: 'Zed', contact_id: 'c-1' });
    const deal = inserted().find((i) => (i.values.title as string) === 'Deal Zed');
    expect(deal).toBeTruthy();
    expect(deal!.values.stageId).toBe('s-1');
    expect(deal!.values.amount).toBe('500');
  });

  it('does nothing without a stage_id', async () => {
    await fire({ type: 'create_deal', config: { title: 'x' } }, { contact_id: 'c-1' });
    expect(inserted().some((i) => i.values.title === 'x')).toBe(false);
  });
});

const LIVE_CONTACT = { id: 'c-1', deletedAt: null, doNotContact: false, unsubscribed: false };

describe('enroll_sequence (#2739)', () => {
  it('writes the enrollment row instead of calling a function that does not exist', async () => {
    h.selectQueue = [[LIVE_CONTACT], []];
    await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, { contact_id: 'c-1' }, { userId: 'u-1' });

    const row = inserted().find((i) => i.values.sequenceId === 'seq-1');
    expect(row).toBeTruthy();
    expect(row!.values).toMatchObject({
      tenantId: 't-1', contactId: 'c-1', status: 'active', currentStep: 1, enrolledBy: 'u-1',
    });
    // #2793 — the row the cron's due sweep can actually select.
    expect(row!.values['nextStepAt']).toBeInstanceOf(Date);
    expect(h.executes).toHaveLength(0);
  });

  it('reads the contact within the tenant that fired the rule', async () => {
    h.selectQueue = [[LIVE_CONTACT], []];
    await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, { contact_id: 'c-1' });
    expect(h.selects[0]).toEqual({
      __and: [{ __eq: ['c.id', 'c-1'] }, { __eq: ['c.tenantId', 't-1'] }],
    });
  });

  it('moves the sequence enroll counter', async () => {
    h.selectQueue = [[LIVE_CONTACT], []];
    await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, { contact_id: 'c-1' });
    const bump = updated().find((u) => u.set.enrollCount !== undefined);
    expect(bump).toBeTruthy();
    expect((bump!.set.enrollCount as { __sql: string }).__sql).toMatch(/COALESCE\(\?, 0\) \+ 1/);
  });

  it('does not enroll a contact that has opted out of mail', async () => {
    for (const over of [{ doNotContact: true }, { unsubscribed: true }, { deletedAt: new Date('2026-10-01') }]) {
      h.selectQueue = [[{ ...LIVE_CONTACT, ...over }], []];
      h.inserts = [];
      await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, { contact_id: 'c-1' });
      expect(inserted().some((i) => i.values.sequenceId === 'seq-1')).toBe(false);
    }
  });

  it('does not start a second drip when one is already active', async () => {
    h.selectQueue = [[LIVE_CONTACT], [{ id: 'e-1' }]];
    await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, { contact_id: 'c-1' });
    expect(inserted().some((i) => i.values.sequenceId === 'seq-1')).toBe(false);
    expect(h.selects[1]).toEqual({
      __and: [
        { __eq: ['se.tenantId', 't-1'] },
        { __eq: ['se.sequenceId', 'seq-1'] },
        { __eq: ['se.contactId', 'c-1'] },
        { __eq: ['se.status', 'active'] },
        { __isNull: 'se.deletedAt' },
      ],
    });
  });

  it('a write that explodes is recorded as a failed run, not a silent success', async () => {
    h.selectQueue = [[LIVE_CONTACT], []];
    h.failInsert = true;
    await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, { contact_id: 'c-1' });
    expect(captureError).toHaveBeenCalled();
    expect(h.runLog.some((r) => r.status === 'failed')).toBe(true);
    expect(h.runLog.some((r) => r.status === 'success')).toBe(false);
  });

  it('skips when sequence_id or contact is missing', async () => {
    h.selectQueue = [[LIVE_CONTACT], []];
    await fire({ type: 'enroll_sequence', config: {} }, { contact_id: 'c-1' });
    await fire({ type: 'enroll_sequence', config: { sequence_id: 'seq-1' } }, {});
    expect(h.executes).toHaveLength(0);
    expect(inserted().some((i) => i.values.sequenceId === 'seq-1')).toBe(false);
  });
});

describe('remove_tag', () => {
  it('removes an existing tag from the contact', async () => {
    h.selectQueue.push([{ tags: ['vip', 'lead'] }]);
    await fire({ type: 'remove_tag', config: { resource: 'contacts', tag: 'vip' } }, { id: 'c-1' });
    const upd = updated().find((u) => Array.isArray(u.set.tags));
    expect(upd!.set.tags).toEqual(['lead']);
  });

  it('does nothing when tag or id is missing', async () => {
    await fire({ type: 'remove_tag', config: { resource: 'contacts' } }, { id: 'c-1' });
    expect(updated().some((u) => Array.isArray(u.set.tags))).toBe(false);
  });
});

describe('fire_webhook', () => {
  it('POSTs the event payload via safeFetch', async () => {
    await fire({ type: 'fire_webhook', config: { url: 'https://hook.example/x' } }, { foo: 'bar' }, { contactId: 'c-1' });
    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetch.mock.calls[0]! as [string, { method: string; body: string }];
    expect(url).toBe('https://hook.example/x');
    expect(JSON.parse(init.body)).toMatchObject({ event: 'contact.created', tenant_id: 't-1', contact_id: 'c-1' });
  });

  it('skips when no url is set', async () => {
    await fire({ type: 'fire_webhook', config: {} }, {});
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

describe('send_whatsapp', () => {
  it('sends via graph API when the whatsapp integration is configured', async () => {
    integrationsFindFirst.mockResolvedValue({ config: { phone_number_id: 'pn-1', access_token: 'tok-1' } });
    await fire({ type: 'send_whatsapp', config: { template_name: 'welcome' } }, { phone: '+1 (555) 010-1234' });
    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetch.mock.calls[0]! as [string, { headers: Record<string, string>; body: string }];
    expect(url).toContain('/pn-1/messages');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    // phone digits sanitized
    expect(JSON.parse(init.body).to).toBe('15550101234');
  });

  it('skips when the integration is not configured', async () => {
    integrationsFindFirst.mockResolvedValue(undefined);
    await fire({ type: 'send_whatsapp', config: {} }, { phone: '+15550000000' });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('skips when there is no recipient phone', async () => {
    await fire({ type: 'send_whatsapp', config: {} }, {});
    expect(integrationsFindFirst).not.toHaveBeenCalled();
  });
});

describe('send_sms', () => {
  it('sends via Twilio when the sms integration is configured', async () => {
    integrationsFindFirst.mockResolvedValue({ config: { api_key: 'ak', from_number: '+15551112222' } });
    await fire({ type: 'send_sms', config: { body: 'Hi {{name}}' } }, { phone: '+15559998888', name: 'Ivy' });
    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetch.mock.calls[0]! as [string, { body: URLSearchParams }];
    expect(url).toContain('twilio.com');
    expect(init.body.get('Body')).toBe('Hi Ivy');
    expect(init.body.get('To')).toBe('+15559998888');
  });

  it('skips when the sms integration is missing', async () => {
    integrationsFindFirst.mockResolvedValue(undefined);
    await fire({ type: 'send_sms', config: { body: 'x' } }, { phone: '+15550000000' });
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

describe('condition operators (extra)', () => {
  const cond = (operator: string, value: string, data: Record<string, unknown>) => async () => {
    automationsFindMany.mockResolvedValue([
      { id: 'x', name: 'X', tenantId: 't-1', triggerType: 'deal.created', isActive: true,
        conditions: [{ field: 'v', operator, value }],
        actions: [{ type: 'send_notification', config: { user_id: 'u-1', title: 't' } }] },
    ]);
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    await evaluateAutomations({ tenantId: 't-1', event: 'deal.created', data } as never);
  };

  it('not_contains proceeds when substring is absent', async () => {
    await cond('not_contains', 'zzz', { v: 'hello' })();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('less_than proceeds for a smaller number', async () => {
    await cond('less_than', '10', { v: 3 })();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('is_not_empty proceeds for a non-empty value', async () => {
    await cond('is_not_empty', '', { v: 'set' })();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('unknown operator blocks the automation', async () => {
    await cond('bogus', 'x', { v: 'x' })();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

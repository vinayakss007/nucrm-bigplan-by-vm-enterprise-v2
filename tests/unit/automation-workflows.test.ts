/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for lib/automation/workflows.ts — prebuilt automation workflows.
 *
 * Covers issue #672 (test-coverage epic): exercises the workflow registry
 * accessors and every prebuilt action.execute() handler, asserting each one
 * calls the correct side-effect (email / notification / db write) with the
 * expected payload. The welcome-email handler also carries an HTML-escaping
 * responsibility (XSS surface), which is verified here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Side-effect mocks ────────────────────────────────────────────────────────
const sendEmail = vi.fn().mockResolvedValue(undefined);
const createNotification = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/email/service', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/notifications', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));

// ── DB mock (used by lead-assignment + follow-up handlers via dynamic import) ─
const dbUpdateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
const dbInsertValues = vi.fn().mockResolvedValue(undefined);
const selectChain = {
  from: vi.fn(() => selectChain),
  where: vi.fn(() => selectChain),
  orderBy: vi.fn(() => selectChain),
  limit: vi.fn(() => Promise.resolve(reps)),
};
let reps: Array<{ userId: string }> = [];

vi.mock('@/drizzle/db', () => ({
  get db() {
    return {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => ({ set: dbUpdateSet })),
      insert: vi.fn(() => ({ values: dbInsertValues })),
    };
  },
}));
vi.mock('@/drizzle/schema', () => ({ tenantMembers: {}, contacts: {}, tasks: {} }));
vi.mock('@/drizzle/relations', () => ({}));

import {
  PREBUILT_WORKFLOWS,
  getWorkflow,
  getAllWorkflows,
  getWorkflowsByCategory,
} from '@/lib/automation/workflows';

const exec = (id: string, data: unknown) => getWorkflow(id)!.actions[0]!.execute(data);

beforeEach(() => {
  vi.clearAllMocks();
  reps = [];
});

describe('workflow registry accessors', () => {
  it('getAllWorkflows returns the full prebuilt list', () => {
    expect(getAllWorkflows()).toBe(PREBUILT_WORKFLOWS);
    expect(getAllWorkflows().length).toBeGreaterThanOrEqual(5);
  });

  it('every workflow has a stable id, one action, and a category', () => {
    for (const w of getAllWorkflows()) {
      expect(w.id).toBeTruthy();
      expect(w.actions.length).toBeGreaterThan(0);
      expect(typeof w.actions[0]!.execute).toBe('function');
      expect(w.category).toBeTruthy();
    }
  });

  it('workflow ids are unique', () => {
    const ids = getAllWorkflows().map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getWorkflow returns the matching workflow', () => {
    expect(getWorkflow('welcome-email')?.name).toBe('Welcome Email');
  });

  it('getWorkflow returns undefined for an unknown id', () => {
    expect(getWorkflow('does-not-exist')).toBeUndefined();
  });

  it('getWorkflowsByCategory filters by category', () => {
    const notifications = getWorkflowsByCategory('Notifications');
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.every((w) => w.category === 'Notifications')).toBe(true);
  });

  it('getWorkflowsByCategory returns [] for an unknown category', () => {
    expect(getWorkflowsByCategory('Nope')).toEqual([]);
  });
});

describe('welcome-email execute', () => {
  it('sends an email to the contact with the tenant name in the subject', async () => {
    await exec('welcome-email', {
      contact: { email: 'new@acme.com', first_name: 'Ada' },
      tenant: { name: 'Acme' },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0]![0] as { to: string; subject: string; html: string };
    expect(arg.to).toBe('new@acme.com');
    expect(arg.subject).toBe('Welcome to Acme!');
    expect(arg.html).toContain('Ada');
  });

  it('escapes HTML in tenant name and contact first name (XSS defense)', async () => {
    await exec('welcome-email', {
      contact: { email: 'x@x.com', first_name: '<script>alert(1)</script>' },
      tenant: { name: '<b>Evil</b>' },
    });
    const arg = sendEmail.mock.calls[0]![0] as { html: string };
    expect(arg.html).not.toContain('<script>alert(1)</script>');
    expect(arg.html).not.toContain('<b>Evil</b>');
    expect(arg.html).toContain('&lt;script&gt;');
  });

  it('falls back to "there" when contact has no first name', async () => {
    await exec('welcome-email', {
      contact: { email: 'x@x.com' },
      tenant: { name: 'Acme' },
    });
    const arg = sendEmail.mock.calls[0]![0] as { html: string };
    expect(arg.html).toContain('there');
  });
});

describe('task-due-reminder execute', () => {
  it('creates a task_due notification for the assignee', async () => {
    await exec('task-due-reminder', {
      tenant_id: 't-1',
      task: { id: 'task-9', title: 'Call client', assigned_to: 'u-1' },
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        tenantId: 't-1',
        type: 'task_due',
        link: '/tenant/tasks/task-9',
      }),
    );
  });
});

describe('deal-stage-change execute', () => {
  it('creates a deal_stage notification describing the transition', async () => {
    await exec('deal-stage-change', {
      tenant_id: 't-1',
      deal: { id: 'd-5', title: 'Big Deal', assigned_to: 'u-2' },
      old_stage: 'Lead',
      new_stage: 'Won',
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-2',
        type: 'deal_stage',
        body: expect.stringContaining('Lead'),
        link: '/tenant/deals/d-5',
      }),
    );
    const arg = createNotification.mock.calls[0]![0] as { body: string };
    expect(arg.body).toContain('Won');
  });
});

describe('lead-assignment execute (round-robin)', () => {
  it('assigns the lead to a selected rep', async () => {
    reps = [{ userId: 'rep-1' }];
    await exec('lead-assignment', { tenant_id: 't-1', lead: { id: 'c-1' } });
    expect(dbUpdateSet).toHaveBeenCalledWith({ assignedTo: 'rep-1' });
  });

  it('prefers contact.id over lead.id when both present', async () => {
    reps = [{ userId: 'rep-1' }];
    await exec('lead-assignment', {
      tenant_id: 't-1',
      contact: { id: 'contact-1' },
      lead: { id: 'lead-1' },
    });
    expect(dbUpdateSet).toHaveBeenCalledWith({ assignedTo: 'rep-1' });
  });

  it('does nothing when no reps are available', async () => {
    reps = [];
    await exec('lead-assignment', { tenant_id: 't-1', lead: { id: 'c-1' } });
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });
});

describe('follow-up-reminder execute', () => {
  it('inserts a follow-up task for the contact', async () => {
    await exec('follow-up-reminder', {
      tenant_id: 't-1',
      contact: { first_name: 'Grace', assigned_to: 'u-3' },
    });
    expect(dbInsertValues).toHaveBeenCalledTimes(1);
    const values = dbInsertValues.mock.calls[0]![0] as {
      tenantId: string;
      title: string;
      assignedTo: string;
      priority: string;
      dueDate: Date;
    };
    expect(values.tenantId).toBe('t-1');
    expect(values.title).toContain('Grace');
    expect(values.assignedTo).toBe('u-3');
    expect(values.priority).toBe('medium');
    expect(values.dueDate).toBeInstanceOf(Date);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test internal functions, so we'll import the module
// and test through the exported evaluateAutomations + mock the DB

// First, let's test the pure functions by extracting their logic
// Since meetsConditions and interpolate are internal, we test them
// via the module's behavior.

// Mock all external dependencies
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      automations: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ catch: vi.fn().mockResolvedValue(undefined) }) }),
    transaction: vi.fn(async (fn) => {
      const tx = {
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      };
      return fn(tx);
    }),
  },
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/capture-error', () => ({
  captureError: vi.fn(),
}));

describe('Automation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('evaluateAutomations', () => {
    it('does nothing when no active automations match', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'deal.created',
        data: { title: 'Test Deal' },
      });

      // No errors thrown, no transaction started
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('executes matching automation with send_email action', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { sendEmail } = await import('@/lib/email/service');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
        id: 'auto-1',
        name: 'Welcome Email',
        tenantId: 'tenant-1',
        triggerType: 'contact.created',
        isActive: true,
        conditions: [],
        actions: [{ type: 'send_email', config: { to: 'test@example.com', subject: 'Hello {{name}}', body: 'Welcome {{name}}!' } }],
      }]);

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { name: 'John', email: 'john@example.com' },
      });

      expect(db.transaction).toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalled();
      const callArgs = (sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(callArgs.to).toBe('test@example.com');
      // Subject is not interpolated (by design - only body is)
      expect(callArgs.subject).toBe('Hello {{name}}');
    });

    it('skips automation when conditions not met', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { sendEmail } = await import('@/lib/email/service');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
        id: 'auto-2',
        name: 'High Value Only',
        tenantId: 'tenant-1',
        triggerType: 'deal.created',
        isActive: true,
        conditions: [{ field: 'amount', operator: 'greater_than', value: '10000' }],
        actions: [{ type: 'send_email', config: { to: 'sales@co.com', subject: 'Big deal!' } }],
      }]);

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'deal.created',
        data: { amount: 500, title: 'Small deal' },
      });

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('executes automation when conditions are met', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { sendEmail } = await import('@/lib/email/service');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
        id: 'auto-3',
        name: 'Big Deal Alert',
        tenantId: 'tenant-1',
        triggerType: 'deal.created',
        isActive: true,
        conditions: [{ field: 'amount', operator: 'greater_than', value: '10000' }],
        actions: [{ type: 'send_email', config: { to: 'vp@co.com', subject: 'Big deal: {{title}}' } }],
      }]);

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'deal.created',
        data: { amount: 50000, title: 'Enterprise Contract' },
      });

      expect(db.transaction).toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalled();
      const callArgs = (sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(callArgs.to).toBe('vp@co.com');
      // Subject template is passed through (interpolation only on body)
      expect(callArgs.subject).toBe('Big deal: {{title}}');
    });

    it('handles send_notification action', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { createNotification } = await import('@/lib/notifications');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
        id: 'auto-4',
        name: 'Task Reminder',
        tenantId: 'tenant-1',
        triggerType: 'task.created',
        isActive: true,
        conditions: [],
        actions: [{ type: 'send_notification', config: { title: 'New task: {{title}}', user_id: 'user-abc' } }],
      }]);

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'task.created',
        data: { title: 'Follow up with client' },
        userId: 'user-xyz',
      });

      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-abc',
        tenantId: 'tenant-1',
        title: 'New task: Follow up with client',
      }));
    });

    it('logs failed run but does not throw', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
        id: 'auto-5',
        name: 'Broken Automation',
        tenantId: 'tenant-1',
        triggerType: 'deal.won',
        isActive: true,
        conditions: [],
        actions: [{ type: 'unknown_action', config: {} }],
      }]);

      // Should not throw — errors are caught per automation
      await expect(evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'deal.won',
        data: {},
      })).resolves.toBeUndefined();
    });

    it('processes multiple automations independently', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { sendEmail } = await import('@/lib/email/service');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'auto-a', name: 'First', tenantId: 'tenant-1', triggerType: 'contact.created',
          isActive: true, conditions: [], actions: [{ type: 'send_email', config: { to: 'a@co.com', subject: 'Hi' } }],
        },
        {
          id: 'auto-b', name: 'Second', tenantId: 'tenant-1', triggerType: 'contact.created',
          isActive: true, conditions: [{ field: 'source', operator: 'equals', value: 'referral' }],
          actions: [{ type: 'send_email', config: { to: 'b@co.com', subject: 'Referral!' } }],
        },
      ]);

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { name: 'Jane', source: 'referral' },
      });

      // Both should fire (first has no conditions, second matches 'referral')
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe('condition operators', () => {
    // Test each condition type through evaluateAutomations
    const makeAutomation = (conditions: Array<{ field: string; operator: string; value: string }>) => [{
      id: 'cond-test', name: 'Cond Test', tenantId: 't1', triggerType: 'deal.created',
      isActive: true, conditions, actions: [{ type: 'send_notification', config: { title: 'fired', user_id: 'u1' } }],
    }];

    it('equals operator matches', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { createNotification } = await import('@/lib/notifications');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAutomation([{ field: 'status', operator: 'equals', value: 'won' }])
      );

      await evaluateAutomations({ tenantId: 't1', event: 'deal.created', data: { status: 'won' } });
      expect(createNotification).toHaveBeenCalled();
    });

    it('not_equals operator', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { createNotification } = await import('@/lib/notifications');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAutomation([{ field: 'status', operator: 'not_equals', value: 'lost' }])
      );

      await evaluateAutomations({ tenantId: 't1', event: 'deal.created', data: { status: 'won' } });
      expect(createNotification).toHaveBeenCalled();
    });

    it('contains operator', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { createNotification } = await import('@/lib/notifications');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAutomation([{ field: 'title', operator: 'contains', value: 'Enterprise' }])
      );

      await evaluateAutomations({ tenantId: 't1', event: 'deal.created', data: { title: 'Enterprise Plan' } });
      expect(createNotification).toHaveBeenCalled();
    });

    it('is_empty operator', async () => {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      const { db } = await import('@/drizzle/db');
      const { createNotification } = await import('@/lib/notifications');

      (db.query.automations.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAutomation([{ field: 'notes', operator: 'is_empty', value: '' }])
      );

      await evaluateAutomations({ tenantId: 't1', event: 'deal.created', data: { notes: '' } });
      expect(createNotification).toHaveBeenCalled();
    });
  });
});

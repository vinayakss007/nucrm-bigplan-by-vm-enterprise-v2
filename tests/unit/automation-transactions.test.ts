import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTransaction = vi.hoisted(() => vi.fn());

const mockDb = vi.hoisted(() => ({
  query: { automations: { findMany: vi.fn() }, integrations: { findFirst: vi.fn() } },
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn() })) })) })),
  execute: vi.fn(),
  transaction: mockTransaction,
}));

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/capture-error', () => ({ captureError: vi.fn() }));

describe('automation/engine transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('evaluateAutomations', () => {
    it('wraps action execution + audit log in a transaction', async () => {
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<void>) => {
        await cb(mockDb);
      });
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [{ type: 'create_task', config: { title: 'Test task' } }], name: 'Test Auto', createdAt: new Date() },
      ]);
      mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockTransaction).toHaveBeenCalled();
    });

    it('logs success run within the same transaction', async () => {
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<void>) => {
        await cb(mockDb);
      });
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [], name: 'Test Auto', createdAt: new Date() },
      ]);
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesFn });

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('logs failed run outside transaction on error', async () => {
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [{ type: 'create_task', config: {} }], name: 'Test Auto', createdAt: new Date() },
      ]);

      mockTransaction.mockRejectedValue(new Error('action failed'));
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesFn });

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('executeAction transaction propagation', () => {
    it('uses dbOrTx for create_task', async () => {
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<void>) => {
        await cb(mockDb);
      });
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [{ type: 'create_task', config: { title: 'Follow up' } }], name: 'Test', createdAt: new Date() },
      ]);
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesFn });

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});

describe('automation/workflow-executor transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('executeWorkflow', () => {
    beforeEach(() => {
      const limitFn = vi.fn().mockResolvedValue([{
        id: 'wf-1',
        status: 'active',
        name: 'Test Workflow',
        nodes: [{ id: 'trigger-1', type: 'trigger', data: {} }],
        edges: [],
      }]);
      const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
      const fromFn = vi.fn().mockReturnValue({ where: whereFn });
      mockDb.select.mockReturnValue({ from: fromFn });
    });

    it('wraps node execution in a transaction', async () => {
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<void>) => {
        await cb(mockDb);
      });

      const returningFn = vi.fn().mockResolvedValue([{ id: 'exec-1' }]);
      const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
      mockDb.insert.mockReturnValue({ values: valuesFn });

      const { executeWorkflow } = await import('@/lib/automation/workflow-executor');

      const result = await executeWorkflow({
        tenantId: 'tenant-1',
        workflowId: 'wf-1',
        inputData: {},
      });

      expect(result).toBe('exec-1');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('updates execution to failed on transaction error', async () => {
      mockTransaction.mockRejectedValue(new Error('execution failed'));

      const returningFn = vi.fn().mockResolvedValue([{ id: 'exec-1' }]);
      const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
      mockDb.insert.mockReturnValue({ values: valuesFn });

      const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDb.update.mockReturnValue({ set: setFn });

      const { executeWorkflow } = await import('@/lib/automation/workflow-executor');

      const result = await executeWorkflow({
        tenantId: 'tenant-1',
        workflowId: 'wf-1',
        inputData: {},
      });

      expect(result).toBe('exec-1');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockInsertChain(resolvedValue?: unknown) {
  return { values: vi.fn().mockResolvedValue(resolvedValue ?? [{ id: 'exec-1' }]) };
}
function mockUpdateChain() {
  return { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) };
}
function mockSelectChain() {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) };
}

const mockTransaction = vi.hoisted(() => vi.fn());

const mockDb = vi.hoisted(() => ({
  query: { automations: { findMany: vi.fn() }, integrations: { findFirst: vi.fn() } },
  insert: vi.fn(mockInsertChain),
  update: vi.fn(mockUpdateChain),
  select: vi.fn(mockSelectChain),
  execute: vi.fn(),
  transaction: mockTransaction,
}));

const mockTx = vi.hoisted(() => ({
  insert: vi.fn(mockInsertChain),
  update: vi.fn(mockUpdateChain),
  select: vi.fn(mockSelectChain),
  execute: vi.fn(),
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
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
        await cb(mockTx);
      });
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [{ type: 'create_task', config: { title: 'Test task' } }], name: 'Test Auto', createdAt: new Date() },
      ]);

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockTx.insert).toHaveBeenCalled();
    });

    it('logs success run within the same transaction', async () => {
      let capturedTx: typeof mockTx | null = null;
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
        capturedTx = mockTx;
        await cb(mockTx);
      });
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [], name: 'Test Auto', createdAt: new Date() },
      ]);

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(capturedTx).toBe(mockTx);
      expect(mockTx.insert).toHaveBeenCalled();
    });

    it('logs failed run outside transaction on error', async () => {
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [{ type: 'create_task', config: {} }], name: 'Test Auto', createdAt: new Date() },
      ]);

      mockTransaction.mockRejectedValue(new Error('action failed'));

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
    });
  });

  describe('executeAction transaction propagation', () => {
    it('uses dbOrTx for create_task', async () => {
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
        await cb(mockTx);
      });
      mockDb.query.automations.findMany.mockResolvedValue([
        { id: 'auto-1', isActive: true, triggerType: 'contact.created', conditions: [], actions: [{ type: 'create_task', config: { title: 'Follow up' } }], name: 'Test', createdAt: new Date() },
      ]);

      const { evaluateAutomations } = await import('@/lib/automation/engine');

      await evaluateAutomations({
        tenantId: 'tenant-1',
        event: 'contact.created',
        data: { email: 'test@test.com' },
      });

      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
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
      mockTransaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
        await cb(mockTx);
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

      const { executeWorkflow } = await import('@/lib/automation/workflow-executor');

      const result = await executeWorkflow({
        tenantId: 'tenant-1',
        workflowId: 'wf-1',
        inputData: {},
      });

      expect(result).toBe('exec-1');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});

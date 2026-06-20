import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.fn();
const mockDbLimitResolve = vi.fn();

vi.mock('@/lib/ai/gateway', () => ({
  chat: mockChat,
  GatewayError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'GatewayError';
    }
  },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => mockDbLimitResolve()),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/crm', () => ({
  contacts: {},
  companies: {},
  deals: {},
}));

vi.mock('@/drizzle/schema/core', () => ({
  tenants: {},
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
}));

describe('AI Summarize', () => {
  let mod: typeof import('@/lib/ai/summarize');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockChat.mockReset();
    mockDbLimitResolve.mockReset();
    mod = await import('@/lib/ai/summarize');
  });

  describe('summarizeEntity', () => {
    it('summarizes a contact', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'c-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '+123', jobTitle: 'Engineer', lifecycleStage: 'lead', leadStatus: 'new', notes: 'Met at conference', companyId: 'comp-1', assignedTo: null, createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-06-01') }])
        .mockResolvedValueOnce([{ name: 'TechCorp' }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      mockChat.mockResolvedValue({
        text: 'Alice Smith is a new lead at TechCorp. Key details: Engineer, met at conference. Next step: follow up.',
        provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 30,
        latencyMs: 1200, fallbacksUsed: 0, activityId: 'act-1',
      });

      const result = await mod.summarizeEntity('t-1', 'u-1', 'contact', 'c-1');

      expect(result.summary).toContain('Alice Smith');
      expect(result.provider).toBe('openai');
      expect(result.tokensUsed).toBe(80);
      expect(result.latencyMs).toBe(1200);
      expect(result.activityId).toBe('act-1');
    });

    it('summarizes a contact without company', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'c-2', firstName: 'Charlie', lastName: 'Brown', email: 'charlie@example.com', phone: null, jobTitle: null, lifecycleStage: null, leadStatus: null, notes: null, companyId: null, assignedTo: null, createdAt: new Date(), updatedAt: new Date() }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      mockChat.mockResolvedValue({
        text: 'Charlie Brown summary.',
        provider: 'openai', model: 'gpt-4', tokensIn: 30, tokensOut: 15,
        latencyMs: 500, fallbacksUsed: 0, activityId: 'act-1a',
      });

      const result = await mod.summarizeEntity('t-1', 'u-1', 'contact', 'c-2');
      expect(result.summary).toContain('Charlie Brown');
    });

    it('summarizes a deal', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'd-1', title: 'Big Deal', amount: '50000', stageId: 'negotiation', status: 'open', closeDate: '2025-12-31', contactId: 'c-1', companyId: 'comp-1', notes: 'Almost closed', createdAt: new Date('2025-03-01'), updatedAt: new Date('2025-06-15') }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }])
        .mockResolvedValueOnce([{ firstName: 'Alice', lastName: 'Smith' }])
        .mockResolvedValueOnce([{ name: 'TechCorp' }]);

      mockChat.mockResolvedValue({
        text: 'Big Deal ($50,000) is in negotiation stage. Contact: Alice Smith at TechCorp.',
        provider: 'openai', model: 'gpt-4', tokensIn: 60, tokensOut: 25,
        latencyMs: 900, fallbacksUsed: 0, activityId: 'act-2',
      });

      const result = await mod.summarizeEntity('t-1', 'u-1', 'deal', 'd-1');
      expect(result.summary).toContain('Big Deal');
    });

    it('summarizes a deal without contact or company', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'd-2', title: 'Solo Deal', amount: null, stageId: null, status: 'open', closeDate: null, contactId: null, companyId: null, notes: null, createdAt: new Date(), updatedAt: new Date() }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      mockChat.mockResolvedValue({
        text: 'Solo Deal summary.',
        provider: 'openai', model: 'gpt-4', tokensIn: 20, tokensOut: 10,
        latencyMs: 300, fallbacksUsed: 0, activityId: 'act-2a',
      });

      const result = await mod.summarizeEntity('t-1', 'u-1', 'deal', 'd-2');
      expect(result.summary).toContain('Solo Deal');
    });

    it('summarizes a company', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'comp-1', name: 'TechCorp', industry: 'SaaS', website: 'https://techcorp.com', domain: 'techcorp.com', description: 'A SaaS company', companySize: '50-200', annualRevenue: '10000000', phone: '+1-555', city: 'San Francisco', country: 'US', notes: 'Growing fast', tags: ['tech', 'saas'], createdAt: new Date('2024-01-01'), updatedAt: new Date('2025-06-01') }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      mockChat.mockResolvedValue({
        text: 'TechCorp is a SaaS company in San Francisco (50-200 employees, $10M revenue). Growing fast.',
        provider: 'openai', model: 'gpt-4', tokensIn: 40, tokensOut: 20,
        latencyMs: 800, fallbacksUsed: 0, activityId: 'act-3',
      });

      const result = await mod.summarizeEntity('t-1', 'u-1', 'company', 'comp-1');
      expect(result.summary).toContain('TechCorp');
    });

    it('throws when entity not found', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      await expect(mod.summarizeEntity('t-1', 'u-1', 'contact', 'nonexistent')).rejects.toThrow('contact not found');
    });

    it('passes custom instructions to the gateway', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'c-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: null, jobTitle: null, lifecycleStage: null, leadStatus: null, notes: null, companyId: null, assignedTo: null, createdAt: new Date(), updatedAt: new Date() }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      mockChat.mockResolvedValue({
        text: 'Custom summary.',
        provider: 'openai', model: 'gpt-4', tokensIn: 50, tokensOut: 20,
        latencyMs: 1000, fallbacksUsed: 0, activityId: 'act-4',
      });

      await mod.summarizeEntity('t-1', 'u-1', 'contact', 'c-1', 'Focus on recent activity');

      expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ action: 'summarize', entityType: 'contact', entityId: 'c-1' }));
      const callArgs = mockChat.mock.calls[0][0] as { messages: Array<{ content: string }> };
      expect(callArgs.messages[0].content).toContain('Focus on recent activity');
    });
  });

  describe('summarizeEntity with AI failure', () => {
    it('propagates GatewayError', async () => {
      mockDbLimitResolve
        .mockResolvedValueOnce([{ id: 'c-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: null, jobTitle: null, lifecycleStage: null, leadStatus: null, notes: null, companyId: null, assignedTo: null, createdAt: new Date(), updatedAt: new Date() }])
        .mockResolvedValueOnce([{ id: 't-1', name: 'Acme Inc', primaryColor: '#fff' }])
        .mockResolvedValueOnce([{ id: 'u-1', fullName: 'Bob', email: 'bob@acme.com' }]);

      const { GatewayError } = await import('@/lib/ai/gateway');
      mockChat.mockRejectedValue(new GatewayError('no_provider_enabled', 'No provider'));

      await expect(mod.summarizeEntity('t-1', 'u-1', 'contact', 'c-1')).rejects.toThrow('No provider');
    });
  });
});

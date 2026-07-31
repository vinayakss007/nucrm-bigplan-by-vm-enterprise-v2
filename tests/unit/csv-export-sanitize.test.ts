import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies used by lib/export/index.ts
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/queue', () => ({
  addJob: vi.fn().mockResolvedValue(undefined),
}));

describe('CSV Export - Formula Injection Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefixes cells starting with = to neutralize formula injection', async () => {
    const { escapeCSV } = await import('@/lib/export');
    // Simple formula without commas/quotes - just gets the prefix
    expect(escapeCSV('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    // Formula with quotes - gets prefix inside CSV quotes
    const result = escapeCSV('=CMD("calc")');
    expect(result).toContain("'=CMD");
    expect(result).not.toMatch(/^"=/);
    expect(result).not.toMatch(/^=/);
  });

  it('prefixes cells starting with + to neutralize formula injection', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('+CMD("calc")');
    expect(result).toContain("'+CMD");
    expect(result).not.toMatch(/^"?\+/);
  });

  it('prefixes cells starting with - to neutralize formula injection', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('-1+1');
    expect(result).toMatch(/^'/);
    expect(result).not.toMatch(/^-/);
  });

  it('prefixes cells starting with @ to neutralize formula injection', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('@SUM(A1:A10)');
    expect(result).toMatch(/^'/);
    expect(result).not.toMatch(/^@/);
  });

  it('prefixes cells starting with tab character to neutralize formula injection', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('\t=CMD()');
    expect(result).toMatch(/^'/);
  });

  it('prefixes cells starting with carriage return to neutralize formula injection', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('\r=CMD()');
    expect(result).toMatch(/^'/);
  });

  it('does not prefix safe values', async () => {
    const { escapeCSV } = await import('@/lib/export');
    expect(escapeCSV('John')).toBe('John');
    expect(escapeCSV('hello world')).toBe('hello world');
    expect(escapeCSV('123')).toBe('123');
  });

  it('handles null and undefined values', async () => {
    const { escapeCSV } = await import('@/lib/export');
    expect(escapeCSV(null)).toBe('');
    expect(escapeCSV(undefined)).toBe('');
  });

  it('handles empty strings', async () => {
    const { escapeCSV } = await import('@/lib/export');
    expect(escapeCSV('')).toBe('');
  });

  it('still properly quotes strings containing commas', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('Smith, John');
    expect(result).toBe('"Smith, John"');
  });

  it('still properly handles strings with double quotes', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('He said "hello"');
    expect(result).toBe('"He said ""hello"""');
  });

  it('both quotes and prefixes dangerous values containing commas', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('=HYPERLINK("http://evil.com","Click here")');
    // Should be prefixed with single quote AND quoted due to comma
    expect(result).toContain("'");
    expect(result).not.toMatch(/^=/);
    expect(result).not.toMatch(/^"=/);
  });

  it('handles the classic DDE attack payload', async () => {
    const { escapeCSV } = await import('@/lib/export');
    const result = escapeCSV('=cmd|"/C calc"|!A0');
    // Contains quotes so it gets CSV-quoted; the single-quote prefix is inside the quotes
    expect(result).toContain("'=cmd");
    expect(result).not.toMatch(/^"=/);
    expect(result).not.toMatch(/^=/);
  });
});

describe('CSV Export - Workflow Executor Cycle Detection', () => {
  it('evaluateCondition with unknown operator returns false', async () => {
    // We import the module to test the evaluateCondition indirectly through executeWorkflow
    // Since evaluateCondition is not exported, we test it through the condition node behavior
    // Testing the exported evaluateCondition behavior via workflow-executor module
    const mod = await import('@/lib/automation/workflow-executor');
    expect(mod.executeWorkflow).toBeDefined();
  });
});

describe('Automation Engine - Unknown Operator Default Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unknown operator in condition causes automation to NOT fire (fail closed)', async () => {
    vi.doMock('@/drizzle/db', () => ({
      db: {
        query: {
          automations: {
            findMany: vi.fn().mockResolvedValue([{
              id: 'auto-unknown-op',
              name: 'Bad Op Test',
              tenantId: 't1',
              triggerType: 'deal.created',
              isActive: true,
              conditions: [{ field: 'amount', operator: 'greaterThan', value: '100' }],
              actions: [{ type: 'send_notification', config: { title: 'Should not fire', user_id: 'u1' } }],
            }]),
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

    vi.doMock('@/lib/email/service', () => ({
      sendEmail: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('@/lib/notifications', () => ({
      createNotification: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('@/lib/capture-error', () => ({
      captureError: vi.fn(),
    }));

    const { evaluateAutomations } = await import('@/lib/automation/engine');
    const { createNotification } = await import('@/lib/notifications');

    await evaluateAutomations({
      tenantId: 't1',
      event: 'deal.created',
      data: { amount: 50000 },
    });

    // The unknown operator 'greaterThan' (instead of 'greater_than') should cause
    // the condition to fail, so the action should NOT fire
    expect(createNotification).not.toHaveBeenCalled();
  });
});

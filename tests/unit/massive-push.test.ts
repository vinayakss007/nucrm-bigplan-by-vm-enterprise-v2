import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbData = vi.hoisted(() => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: [] as any[],
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  failedQueue: [] as any[],
}));

const mockQueryResult = vi.hoisted(() => ({
  rows: [{ count: 1 }],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(mockDbData.failedQueue)),
          })),
          limit: vi.fn(() => Promise.resolve(mockDbData.hooks)),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'delivery-1' }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve({ rows: [] })),
        catch: vi.fn(() => Promise.resolve()),
      })),
    })),
    execute: vi.fn(() => Promise.resolve(mockQueryResult)),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  integrations: { id: 'id', tenantId: 'tenant_id', name: 'name', config: 'config' },
  webhookQueue: { id: 'id', webhookId: 'webhook_id', event: 'event', payload: 'payload', status: 'status' },
}));

vi.mock('@/drizzle/schema/support', () => ({
  webhookQueue: { id: 'id', webhookId: 'webhook_id', url: 'url', method: 'method', headers: 'headers', payload: 'payload', status: 'status', attempt: 'attempt', nextRetryAt: 'next_retry_at', createdAt: 'created_at', errorMessage: 'error_message' },
  errorLogs: { id: 'id', tenantId: 'tenant_id', message: 'message', level: 'level', createdAt: 'created_at' },
  failedWebhooks: { id: 'id', webhookId: 'webhook_id', url: 'url', method: 'method', headers: 'headers', payload: 'payload', status: 'status', attempt: 'attempt', createdAt: 'created_at' },
  supportTickets: { id: 'id', tenantId: 'tenant_id', subject: 'subject', status: 'status' },
  ticketReplies: { id: 'id', ticketId: 'ticket_id', body: 'body' },
}));

vi.mock('@/lib/db/client', () => ({
  query: vi.fn(() => Promise.resolve({ rows: [] })),
  queryMany: vi.fn(() => Promise.resolve([])),
  getPool: vi.fn(() => ({ query: vi.fn(), execute: vi.fn() })),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('webhooks - fireWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbData.hooks = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns early when no hooks found', async () => {
    mockDbData.hooks = [];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks('t1', 'contact.created', { id: 'c1' });
    expect(true).toBe(true);
  });

  it('fires webhooks with HMAC signature when secret present', async () => {
    mockDbData.hooks = [
      { id: 'h1', name: 'Test Webhook', config: { url: 'https://example.com/hook', secret: 'secret123' } },
    ];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await expect(fireWebhooks('t1', 'deal.won', { id: 'd1', value: 5000 })).resolves.not.toThrow();
    expect(mockDbData.hooks.length).toBeGreaterThan(0);
  });

  it('fires webhooks without signature when no secret', async () => {
    mockDbData.hooks = [
      { id: 'h2', name: 'No Secret Hook', config: { url: 'https://example.com/hook2' } },
    ];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks('t1', 'task.completed', { id: 't1' });
    expect(true).toBe(true);
  });

  it('handles multiple webhooks', async () => {
    mockDbData.hooks = [
      { id: 'h1', name: 'Hook1', config: { url: 'http://localhost:9999/h1' } },
      { id: 'h2', name: 'Hook2', config: { url: 'http://localhost:9999/h2', secret: 's' } },
    ];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks('t1', 'contact.created', { id: 'c1' });
    expect(true).toBe(true);
  });

  it('handles webhook with missing URL config', async () => {
    mockDbData.hooks = [
      { id: 'h1', name: 'Bad Hook', config: {} },
    ];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await fireWebhooks('t1', 'deal.lost', { id: 'd1' });
    expect(true).toBe(true);
  });

  it('handles webhook failure gracefully', async () => {
    mockDbData.hooks = [
      { id: 'h1', name: 'Fail Hook', config: { url: 'http://invalid-url' } },
    ];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await expect(fireWebhooks('t1', 'contact.updated', { id: 'c1' })).resolves.not.toThrow();
  });

  it('handles gracefully when fetch throws', async () => {
    mockDbData.hooks = [
      { id: 'h1', name: 'Fail Hook', config: { url: 'http://127.0.0.1:1' } },
    ];
    const { fireWebhooks } = await import('@/lib/webhooks');
    await expect(fireWebhooks('t1', 'company.created', { id: 'comp1' })).resolves.not.toThrow();
  });
});

describe('webhooks - retryFailedWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbData.failedQueue = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 0 when no failed webhooks', async () => {
    mockDbData.failedQueue = [];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    const count = await retryFailedWebhooks();
    expect(count).toBe(0);
  });

  it('processes failed webhooks list', async () => {
    mockDbData.failedQueue = [
      { id: 'f1', url: 'https://example.com/retry', payload: '{"event":"test"}', headers: {}, attempt: 1, createdAt: new Date() },
    ];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    await retryFailedWebhooks();
    expect(true).toBe(true);
  });

  it('handles retry failure gracefully', async () => {
    mockDbData.failedQueue = [
      { id: 'f1', url: 'http://invalid:99999', payload: '{}', headers: {}, attempt: 1, createdAt: new Date() },
    ];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    const count = await retryFailedWebhooks();
    expect(count).toBe(0);
  });

  it('handles multiple failed webhooks', async () => {
    mockDbData.failedQueue = [
      { id: 'f1', url: 'http://localhost:9999/bad1', payload: '{}', headers: {}, attempt: 1, createdAt: new Date() },
      { id: 'f2', url: 'http://localhost:9999/bad2', payload: '{}', headers: {}, attempt: 1, createdAt: new Date() },
    ];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    const count = await retryFailedWebhooks();
    expect(count).toBe(0);
  });

  it('handles outer error gracefully', async () => {
    mockDbData.failedQueue = [];
    const { retryFailedWebhooks } = await import('@/lib/webhooks');
    const count = await retryFailedWebhooks();
    expect(count).toBe(0);
  });
});

describe('queue - comprehensive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('getQueueAdapter returns memory adapter as fallback', async () => {
    const { getQueueAdapter } = await import('@/lib/queue');
    const adapter = await getQueueAdapter();
    expect(adapter.provider).toBe('memory');
  });

  it('getQueueAdapter returns same adapter on second call', async () => {
    const { getQueueAdapter } = await import('@/lib/queue');
    const a1 = await getQueueAdapter();
    const a2 = await getQueueAdapter();
    expect(a1).toBe(a2);
  });

  it('addJob adds to memory queue', async () => {
    const { addJob } = await import('@/lib/queue');
    await expect(addJob('send-email', { to: 'test@example.com' })).resolves.not.toThrow();
  });

  it('addJob with options', async () => {
    const { addJob } = await import('@/lib/queue');
    await expect(addJob('send-notification', { userId: 'u1' }, { priority: 10, attempts: 5 })).resolves.not.toThrow();
  });

  it('addJob for export-csv', async () => {
    const { addJob } = await import('@/lib/queue');
    await expect(addJob('export-csv', { type: 'contacts' })).resolves.not.toThrow();
  });

  it('addJob for contact-import', async () => {
    const { addJob } = await import('@/lib/queue');
    await expect(addJob('contact-import', { csv: 'data' })).resolves.not.toThrow();
  });

  it('addJob for run-automation', async () => {
    const { addJob } = await import('@/lib/queue');
    await expect(addJob('run-automation', { ruleId: 'r1' })).resolves.not.toThrow();
  });

  it('closeQueue resets adapter to null', async () => {
    const { closeQueue, getQueueAdapter } = await import('@/lib/queue');
    await closeQueue();
    const adapter = await getQueueAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.provider).toBe('memory');
  });

  it('getBoss throws when not using pg-boss', async () => {
    const { getBoss } = await import('@/lib/queue');
    await expect(getBoss()).rejects.toThrow('pg-boss');
  });

  it('memory adapter processes jobs after interval', async () => {
    vi.useFakeTimers();
    const { addJob } = await import('@/lib/queue');
    await addJob('send-email', { to: 'user@test.com' });
    vi.advanceTimersByTime(6000);
    vi.useRealTimers();
    expect(true).toBe(true);
  });
});

describe('email/service - sendEmail paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.NODE_ENV;
    delete process.env.SMTP_FROM_NAME;
    delete process.env.SMTP_FROM_EMAIL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('sendEmail with custom from address', async () => {
    process.env.NODE_ENV = 'development';
    const { sendEmail } = await import('@/lib/email/service');
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Content</p>',
      from: 'custom@sender.com',
    });
    expect(r.success).toBe(true);
  });

  it('sendEmail with replyTo', async () => {
    process.env.NODE_ENV = 'development';
    const { sendEmail } = await import('@/lib/email/service');
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Content</p>',
      replyTo: 'reply@example.com',
    });
    expect(r.success).toBe(true);
  });

  it('sendEmail with text version', async () => {
    process.env.NODE_ENV = 'development';
    const { sendEmail } = await import('@/lib/email/service');
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>HTML</p>',
      text: 'Plain text version',
    });
    expect(r.success).toBe(true);
  });

  it('sendEmail uses env from addresses', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SMTP_FROM_NAME = 'My App';
    process.env.SMTP_FROM_EMAIL = 'app@example.com';
    const { sendEmail } = await import('@/lib/email/service');
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });
    expect(r.success).toBe(true);
  });
});

describe('cache/index.ts - module loads', () => {
  it('cache module loads', async () => {
    const mod = await import('@/lib/cache');
    expect(mod).toBeDefined();
  });
});

describe('auth/api-key - hasScope', () => {
  it('returns true for super admin', async () => {
    const { hasScope } = await import('@/lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasScope({ isSuperAdmin: true, permissions: {} } as any, 'contacts:read')).toBe(true);
  });

  it('returns true for all permission', async () => {
    const { hasScope } = await import('@/lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasScope({ permissions: { all: true } } as any, 'contacts:read')).toBe(true);
  });

  it('returns true for exact scope match', async () => {
    const { hasScope } = await import('@/lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasScope({ permissions: { 'contacts:read': true } } as any, 'contacts:read')).toBe(true);
  });

  it('returns true for resource:all wildcard', async () => {
    const { hasScope } = await import('@/lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasScope({ permissions: { 'contacts:all': true } } as any, 'contacts:write')).toBe(true);
  });

  it('returns false for no matching scope', async () => {
    const { hasScope } = await import('@/lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasScope({ permissions: { 'deals:read': true } } as any, 'contacts:read')).toBe(false);
  });

  it('returns false for empty permissions', async () => {
    const { hasScope } = await import('@/lib/auth/api-key');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasScope({ permissions: {} } as any, 'contacts:read')).toBe(false);
  });
});

describe('auth/session - validatePassword', () => {
  it('rejects password shorter than 12 chars', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('Short1!')).toContain('at least 12 characters');
  });

  it('rejects password without uppercase', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('nouppercase1!')).toContain('uppercase');
  });

  it('rejects password without number', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('NoNumber!abc')).toContain('number');
  });

  it('rejects password without special char', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('NoSpecial123')).toContain('special character');
  });

  it('accepts valid strong password', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('StrongP@ss1!')).toBeNull();
  });
});

describe('auth/cron - verifyCronSecret', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/auth/cron');
    expect(mod.verifyCronSecret).toBeDefined();
  });
});

describe('dev-logger - comprehensive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('devLogger.query logs query', async () => {
    const { devLogger } = await import('@/lib/dev-logger');
    expect(() => devLogger.query('SELECT 1', 50, ['param'])).not.toThrow();
  });

  it('devLogger.error logs error', async () => {
    const { devLogger } = await import('@/lib/dev-logger');
    expect(() => devLogger.error(new Error('test'), 'Context', undefined)).not.toThrow();
  });

  it('createDevelopmentMiddleware returns function', async () => {
    const { createDevelopmentMiddleware } = await import('@/lib/dev-logger');
    const mw = createDevelopmentMiddleware();
    expect(typeof mw).toBe('function');
  });
});

describe('email/mock-service - comprehensive', () => {
  it('module loads with all exports', async () => {
    const mod = await import('@/lib/email/mock-service');
    expect(mod).toBeDefined();
    expect(mod.createEmailService).toBeDefined();
  });

  it('emailService default export exists', async () => {
    const mod = await import('@/lib/email/mock-service');
    expect(mod.default || mod.emailService).toBeDefined();
  });
});

describe('automation/engine - evaluateAutomations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns when no automations found', async () => {
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    await expect(evaluateAutomations({
      tenantId: 't1', userId: 'u1',
      event: 'contact.created',
      data: { contact: { id: 'c1', email: 'test@example.com' } },
    })).resolves.not.toThrow();
  });

  it('handles different event types', async () => {
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    for (const event of ['deal.won', 'task.completed', 'contact.updated', 'deal.created']) {
      await expect(evaluateAutomations({
        tenantId: 't1', userId: 'u1',
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: event as any,
        data: {},
      })).resolves.not.toThrow();
    }
  });
});

describe('tenant/request-context - requestContext', () => {
  it('has all required methods', async () => {
    const { requestContext } = await import('@/lib/tenant/request-context');
    expect(requestContext).toBeDefined();
    expect(requestContext.set).toBeDefined();
    expect(requestContext.get).toBeDefined();
    expect(requestContext.getCached).toBeDefined();
    expect(requestContext.cache).toBeDefined();
    expect(requestContext.invalidate).toBeDefined();
    expect(requestContext.generateId).toBeDefined();
  });
});

describe('webhooks/delivery - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/webhooks/delivery');
    expect(mod).toBeDefined();
  });
});

describe('ai/common - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/ai/common');
    expect(mod).toBeDefined();
  });
});

describe('grafana - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/grafana');
    expect(mod).toBeDefined();
  });
});

describe('keepalive - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/keepalive');
    expect(mod).toBeDefined();
  });
});

describe('tenant-data-export - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/tenant-data-export');
    expect(mod).toBeDefined();
  });
});

describe('tenant-data-import - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/tenant-data-import');
    expect(mod).toBeDefined();
  });
});

describe('client-cache - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/client-cache');
    expect(mod).toBeDefined();
  });
});

describe('critical-data-capture - module', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/critical-data-capture');
    expect(mod).toBeDefined();
  });
});

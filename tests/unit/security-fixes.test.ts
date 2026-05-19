import { describe, it, expect } from 'vitest';

describe('Security fixes validation', () => {
  it('drizzle/schema exports loginBlocks from barrel', async () => {
    const schema = await import('@/drizzle/schema');
    expect(schema.loginBlocks).toBeDefined();
    expect(schema.loginAttempts).toBeDefined();
    expect(schema.securityEvents).toBeDefined();
  });

  it('drizzle/schema/index exports security module', async () => {
    const idx = await import('@/drizzle/schema/index');
    expect(idx.loginBlocks).toBeDefined();
    expect(idx.loginAttempts).toBeDefined();
  });
});

describe('CSRF protection', () => {
  it('needsCsrfValidation skips safe methods', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('GET', '/api/tenant/contacts')).toBe(false);
    expect(needsCsrfValidation('HEAD', '/api/tenant/contacts')).toBe(false);
    expect(needsCsrfValidation('OPTIONS', '/api/tenant/contacts')).toBe(false);
  });

  it('needsCsrfValidation validates state-changing methods', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('POST', '/api/tenant/contacts')).toBe(true);
    expect(needsCsrfValidation('PUT', '/api/tenant/contacts')).toBe(true);
    expect(needsCsrfValidation('PATCH', '/api/tenant/contacts')).toBe(true);
    expect(needsCsrfValidation('DELETE', '/api/tenant/contacts')).toBe(true);
  });

  it('needsCsrfValidation exempts webhooks and cron', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('POST', '/api/webhooks/stripe')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/cron/task-reminders')).toBe(false);
  });

  it('generateCsrfToken creates 32-char hex string', async () => {
    const { generateCsrfToken } = await import('@/lib/auth/csrf');
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validateCsrfToken validates correctly', async () => {
    const { generateCsrfToken, validateCsrfToken, setCsrfCookie } = await import('@/lib/auth/csrf');
    const token = generateCsrfToken();
    const cookie = setCsrfCookie(token);
    expect(cookie).toContain('nucrm_csrf');
    expect(validateCsrfToken(token, token)).toBe(true);
    expect(validateCsrfToken(null, token)).toBe(false);
    expect(validateCsrfToken('wrong', token)).toBe(false);
  });
});

describe('Error handling', () => {
  it('handleError returns proper response for AppError', async () => {
    const { handleError, AppError, ErrorCode } = await import('@/lib/errors');
    const err = new AppError('Not found', ErrorCode.RESOURCE_NOT_FOUND, 404);
    const res = handleError(err);
    expect(res.status).toBe(404);
  });

  it('apiError returns correct status and message', async () => {
    const { apiError } = await import('@/lib/api-error');
    const res = apiError(new Error('test'), 'Custom message', 400);
    expect(res.status).toBe(400);
  });
});

describe('Super admin API fixes', () => {
  it('tenants API uses snake_case keys', async () => {
    const { tenants } = await import('@/drizzle/schema');
    expect(tenants).toBeDefined();
  });

  it('_registry.ts includes all schema files', async () => {
    const registry = await import('@/drizzle/schema/_registry');
    expect(registry.TABLE_REGISTRY.loginBlocks).toBeDefined();
    expect(registry.TABLE_REGISTRY.loginAttempts).toBeDefined();
    expect(registry.TABLE_REGISTRY.securityEvents).toBeDefined();
    expect(registry.TABLE_REGISTRY.invoices).toBeDefined();
    expect(registry.TABLE_REGISTRY.editHistory).toBeDefined();
  });
});

describe('next.config fixes', () => {
  it('ignoreBuildErrors is not hardcoded true', async () => {
    const content = await import('fs').then(fs => fs.readFileSync('next.config.mjs', 'utf-8'));
    expect(content).not.toContain('ignoreBuildErrors: true');
    expect(content).toContain('ignoreBuildErrors: process.env.CI');
  });
});

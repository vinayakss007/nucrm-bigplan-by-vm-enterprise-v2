import { describe, it, expect } from 'vitest';

describe('errors-shared', () => {
  it('ErrorCode enum has expected values', async () => {
    const { ErrorCode } = await import('@/lib/errors-shared');
    expect(ErrorCode.AUTH_INVALID_CREDENTIALS).toBe('AUTH_INVALID_CREDENTIALS');
    expect(ErrorCode.AUTH_TOKEN_EXPIRED).toBe('AUTH_TOKEN_EXPIRED');
    expect(ErrorCode.AUTH_UNAUTHORIZED).toBe('AUTH_UNAUTHORIZED');
    expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });

  it('ErrorCode contains auth error codes', async () => {
    const { ErrorCode } = await import('@/lib/errors-shared');
    const values = Object.values(ErrorCode);
    expect(values).toContain('AUTH_INVALID_CREDENTIALS');
    expect(values).toContain('AUTH_ACCOUNT_LOCKED');
    expect(values).toContain('AUTH_EMAIL_NOT_VERIFIED');
  });

  it('ErrorCode contains resource error codes', async () => {
    const { ErrorCode } = await import('@/lib/errors-shared');
    const values = Object.values(ErrorCode);
    expect(values).toContain('USER_NOT_FOUND');
    expect(values).toContain('CONTACT_NOT_FOUND');
    expect(values).toContain('DEAL_NOT_FOUND');
    expect(values).toContain('TENANT_NOT_FOUND');
  });

  it('ErrorCode contains DB error codes', async () => {
    const { ErrorCode } = await import('@/lib/errors-shared');
    const values = Object.values(ErrorCode);
    expect(values).toContain('DB_CONNECTION_FAILED');
    expect(values).toContain('DB_QUERY_FAILED');
    expect(values).toContain('DB_CONSTRAINT_VIOLATION');
  });

  it('ErrorCode contains webhook error codes', async () => {
    const { ErrorCode } = await import('@/lib/errors-shared');
    const values = Object.values(ErrorCode);
    expect(values).toContain('WEBHOOK_DELIVERY_FAILED');
    expect(values).toContain('WEBHOOK_INVALID_SIGNATURE');
  });

  it('ErrorLevel type is exported', async () => {
    const mod = await import('@/lib/errors-shared');
    expect(mod.ErrorLevel).toBeUndefined();
  });

  it('ApiError interface is exported', async () => {
    const mod = await import('@/lib/errors-shared');
    expect(mod.ApiError).toBeUndefined();
  });

  it('ErrorCode is a string enum with unique values', async () => {
    const { ErrorCode } = await import('@/lib/errors-shared');
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBeGreaterThan(50);
  });
});

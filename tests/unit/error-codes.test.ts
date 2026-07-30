/**
 * Tests for lib/api/error-codes.ts
 */
import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  apiErr,
  getErrorStatus,
  getAllErrorCodes,
} from '@/lib/api/error-codes';

describe('ErrorCode', () => {
  it('contains auth codes', () => {
    expect(ErrorCode.AUTH_REQUIRED).toBe('AUTH_REQUIRED');
    expect(ErrorCode.AUTH_TOKEN_EXPIRED).toBe('AUTH_TOKEN_EXPIRED');
    expect(ErrorCode.AUTH_INSUFFICIENT_SCOPE).toBe('AUTH_INSUFFICIENT_SCOPE');
  });

  it('contains validation codes', () => {
    expect(ErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
    expect(ErrorCode.VALIDATION_BODY_EMPTY).toBe('VALIDATION_BODY_EMPTY');
    expect(ErrorCode.VALIDATION_INVALID_JSON).toBe('VALIDATION_INVALID_JSON');
  });

  it('contains resource codes', () => {
    expect(ErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
    expect(ErrorCode.RESOURCE_ALREADY_EXISTS).toBe('RESOURCE_ALREADY_EXISTS');
  });

  it('contains rate limit codes', () => {
    expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
    expect(ErrorCode.DUPLICATE_REQUEST).toBe('DUPLICATE_REQUEST');
  });
});

describe('apiErr', () => {
  it('returns correct status for 404', async () => {
    const response = apiErr(ErrorCode.RESOURCE_NOT_FOUND);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.error).toBe('Resource not found');
  });

  it('returns correct status for 401', async () => {
    const response = apiErr(ErrorCode.AUTH_REQUIRED);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns correct status for 429', async () => {
    const response = apiErr(ErrorCode.RATE_LIMIT_EXCEEDED);
    expect(response.status).toBe(429);
  });

  it('includes details in response', async () => {
    const response = apiErr(ErrorCode.RESOURCE_NOT_FOUND, {
      resource: 'Contact',
      id: 'abc-123',
    });
    const body = await response.json();
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.resource).toBe('Contact');
    expect(body.id).toBe('abc-123');
  });

  it('allows overriding the message', async () => {
    const response = apiErr(ErrorCode.VALIDATION_FAILED, undefined, 'Email is already taken');
    const body = await response.json();
    expect(body.error).toBe('Email is already taken');
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 500 for internal errors', async () => {
    const response = apiErr(ErrorCode.INTERNAL_ERROR);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 409 for concurrency conflicts', async () => {
    const response = apiErr(ErrorCode.CONCURRENCY_CONFLICT, {
      expectedVersion: '2024-01-01',
      actualVersion: '2024-01-02',
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.expectedVersion).toBe('2024-01-01');
  });

  it('omits details when empty', async () => {
    const response = apiErr(ErrorCode.AUTH_REQUIRED, {});
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['error', 'code']);
  });

  it('returns 403 for suspended tenant', async () => {
    const response = apiErr(ErrorCode.TENANT_SUSPENDED);
    expect(response.status).toBe(403);
  });

  it('returns 402 for quota exceeded', async () => {
    const response = apiErr(ErrorCode.QUOTA_EXCEEDED, { limit: 1000, current: 1001 });
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.limit).toBe(1000);
  });
});

describe('getErrorStatus', () => {
  it('returns status for known codes', () => {
    expect(getErrorStatus(ErrorCode.AUTH_REQUIRED)).toBe(401);
    expect(getErrorStatus(ErrorCode.RESOURCE_NOT_FOUND)).toBe(404);
    expect(getErrorStatus(ErrorCode.RATE_LIMIT_EXCEEDED)).toBe(429);
    expect(getErrorStatus(ErrorCode.INTERNAL_ERROR)).toBe(500);
  });
});

describe('getAllErrorCodes', () => {
  it('returns all registered codes', () => {
    const codes = getAllErrorCodes();
    expect(codes.length).toBeGreaterThan(20);
    expect(codes.every((c) => c.code && c.status && c.message)).toBe(true);
  });

  it('includes expected codes', () => {
    const codes = getAllErrorCodes();
    const codeStrings = codes.map((c) => c.code);
    expect(codeStrings).toContain('AUTH_REQUIRED');
    expect(codeStrings).toContain('RESOURCE_NOT_FOUND');
    expect(codeStrings).toContain('RATE_LIMIT_EXCEEDED');
    expect(codeStrings).toContain('INTERNAL_ERROR');
  });

  it('all statuses are valid HTTP codes', () => {
    const codes = getAllErrorCodes();
    expect(codes.every((c) => c.status >= 400 && c.status < 600)).toBe(true);
  });
});

/**
 * Tests for lib/api/request-fingerprint.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  rejectDuplicate,
  clearFingerprints,
  getFingerprintCount,
} from '@/lib/api/request-fingerprint';

function makeRequest(method: string, path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method });
}

describe('rejectDuplicate', () => {
  beforeEach(() => {
    clearFingerprints();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first request through (returns null)', () => {
    const req = makeRequest('POST', '/api/tenant/contacts');
    const result = rejectDuplicate(req, 'user-1', 'body-hash-1');
    expect(result).toBeNull();
  });

  it('blocks identical request within window (returns 409)', async () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1', 'body-hash-1');
    const result = rejectDuplicate(req2, 'user-1', 'body-hash-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe(409);
    const body = await result!.json();
    expect(body.code).toBe('DUPLICATE_REQUEST');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('allows request after window expires', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1', 'body-hash-1');

    // Advance time past the 5s window
    vi.advanceTimersByTime(6000);

    const result = rejectDuplicate(req2, 'user-1', 'body-hash-1');
    expect(result).toBeNull();
  });

  it('different users are not treated as duplicates', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1', 'body-hash-1');
    const result = rejectDuplicate(req2, 'user-2', 'body-hash-1');

    expect(result).toBeNull();
  });

  it('different paths are not treated as duplicates', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/deals');

    rejectDuplicate(req1, 'user-1', 'body-hash-1');
    const result = rejectDuplicate(req2, 'user-1', 'body-hash-1');

    expect(result).toBeNull();
  });

  it('different body hashes are not treated as duplicates', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1', 'hash-A');
    const result = rejectDuplicate(req2, 'user-1', 'hash-B');

    expect(result).toBeNull();
  });

  it('works without body hash', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1');
    const result = rejectDuplicate(req2, 'user-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe(409);
  });

  it('custom windowMs is respected', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1', 'hash', { windowMs: 2000 });

    vi.advanceTimersByTime(2500);

    const result = rejectDuplicate(req2, 'user-1', 'hash', { windowMs: 2000 });
    expect(result).toBeNull();
  });

  it('includes Retry-After header in 409 response', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/contacts');

    rejectDuplicate(req1, 'user-1', 'hash');
    const result = rejectDuplicate(req2, 'user-1', 'hash');

    expect(result!.headers.get('Retry-After')).toBe('1');
  });

  it('clearFingerprints resets the store', () => {
    const req = makeRequest('POST', '/api/tenant/contacts');
    rejectDuplicate(req, 'user-1', 'hash');

    expect(getFingerprintCount()).toBe(1);
    clearFingerprints();
    expect(getFingerprintCount()).toBe(0);
  });

  it('getFingerprintCount tracks entries', () => {
    const req1 = makeRequest('POST', '/api/tenant/contacts');
    const req2 = makeRequest('POST', '/api/tenant/deals');

    rejectDuplicate(req1, 'user-1', 'hash-1');
    rejectDuplicate(req2, 'user-1', 'hash-2');

    expect(getFingerprintCount()).toBe(2);
  });
});

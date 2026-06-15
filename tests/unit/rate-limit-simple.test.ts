import { describe, it, expect } from 'vitest';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRequest(ip: string | null): any {
  return {
    headers: { get: (name: string) => {
      if (name === 'x-forwarded-for') return ip;
      if (name === 'x-real-ip') return null;
      return null;
    }},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRequestRealIp(ip: string): any {
  return {
    headers: { get: (name: string) => {
      if (name === 'x-forwarded-for') return null;
      if (name === 'x-real-ip') return ip;
      return null;
    }},
  };
}

describe('checkPublicRateLimit', () => {
  it('returns null for first request (under limit)', () => {
    const req = mockRequest('1.2.3.4');
    const result = checkPublicRateLimit(req, { max: 5, windowMs: 60000 });
    expect(result).toBeNull();
  });

  it('returns null for requests under the max', () => {
    const req = mockRequest('5.6.7.8');
    for (let i = 0; i < 4; i++) {
      expect(checkPublicRateLimit(req, { max: 5, windowMs: 60000 })).toBeNull();
    }
  });

  it('returns 429 when exceeding max', () => {
    const req = mockRequest('10.0.0.1');
    const opts = { max: 2, windowMs: 60000 };
    expect(checkPublicRateLimit(req, opts)).toBeNull();
    expect(checkPublicRateLimit(req, opts)).toBeNull();
    const result = checkPublicRateLimit(req, opts);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('uses different counters for different IPs', () => {
    const req1 = mockRequest('100.1.1.1');
    const req2 = mockRequest('200.2.2.2');
    const opts = { max: 1, windowMs: 60000 };
    expect(checkPublicRateLimit(req1, opts)).toBeNull();
    expect(checkPublicRateLimit(req2, opts)).toBeNull();
  });

  it('uses different counters for different prefixes', () => {
    const req = mockRequest('50.50.50.50');
    const opts = { max: 1, windowMs: 60000 };
    expect(checkPublicRateLimit(req, { ...opts, prefix: 'api' })).toBeNull();
    expect(checkPublicRateLimit(req, { ...opts, prefix: 'auth' })).toBeNull();
  });

  it('includes Retry-After header in 429 response', () => {
    const req = mockRequest('99.99.99.99');
    const opts = { max: 1, windowMs: 60000 };
    checkPublicRateLimit(req, opts);
    const result = checkPublicRateLimit(req, opts)!;
    expect(result.headers.get('Retry-After')).toBeDefined();
    expect(result.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(result.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(result.headers.get('X-RateLimit-Reset')).toBeDefined();
  });

  it('falls back to unknown IP when no headers', () => {
    const req = { headers: { get: () => null } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = checkPublicRateLimit(req as any, { max: 100, windowMs: 60000 });
    expect(result).toBeNull();
  });

  it('uses x-real-ip when x-forwarded-for is absent', () => {
    const req = mockRequestRealIp('192.168.1.1');
    const opts = { max: 1, windowMs: 60000 };
    expect(checkPublicRateLimit(req, opts)).toBeNull();
    const result = checkPublicRateLimit(req, opts);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('respects custom max and windowMs', () => {
    const req = mockRequest('10.10.10.10');
    const opts = { max: 3, windowMs: 1000 };
    expect(checkPublicRateLimit(req, opts)).toBeNull();
    expect(checkPublicRateLimit(req, opts)).toBeNull();
    expect(checkPublicRateLimit(req, opts)).toBeNull();
    const result = checkPublicRateLimit(req, opts);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('uses default options when none provided', () => {
    const req = mockRequest('1.2.3.4');
    const result = checkPublicRateLimit(req);
    expect(result).toBeNull();
  });

  it('handles x-forwarded-for with multiple IPs', () => {
    const req = { headers: { get: (_name: string) => '172.31.0.1, 172.31.0.2, 172.31.0.3' } };
    const opts = { max: 1, windowMs: 60000 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(checkPublicRateLimit(req as any, opts)).toBeNull();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = checkPublicRateLimit(req as any, opts);
    expect(result).not.toBeNull();
  });
});

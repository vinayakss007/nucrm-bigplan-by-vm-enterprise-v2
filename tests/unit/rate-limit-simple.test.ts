import { describe, it, expect } from 'vitest';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';

function mockRequest(ip: string): any {
  return {
    headers: new Map([['x-forwarded-for', ip]]),
    headers: { get: (name: string) => name === 'x-forwarded-for' ? ip : null },
  };
}

describe('checkPublicRateLimit', () => {
  it('returns null for first request (under limit)', () => {
    const req = mockRequest('1.2.3.4');
    const result = checkPublicRateLimit(req as any, { max: 5, windowMs: 60000 });
    expect(result).toBeNull();
  });

  it('returns null for requests under the max', () => {
    const req = mockRequest('5.6.7.8');
    for (let i = 0; i < 4; i++) {
      expect(checkPublicRateLimit(req as any, { max: 5, windowMs: 60000 })).toBeNull();
    }
  });

  it('returns 429 when exceeding max', () => {
    const req = mockRequest('10.0.0.1');
    const opts = { max: 2, windowMs: 60000 };
    expect(checkPublicRateLimit(req as any, opts)).toBeNull();
    expect(checkPublicRateLimit(req as any, opts)).toBeNull();
    const result = checkPublicRateLimit(req as any, opts);
    expect(result).not.toBeNull();
    const resp = result!;
    expect(resp.status).toBe(429);
  });

  it('uses different counters for different IPs', () => {
    const req1 = mockRequest('100.1.1.1');
    const req2 = mockRequest('200.2.2.2');
    const opts = { max: 1, windowMs: 60000 };
    expect(checkPublicRateLimit(req1 as any, opts)).toBeNull();
    expect(checkPublicRateLimit(req2 as any, opts)).toBeNull();
  });

  it('uses different counters for different prefixes', () => {
    const req = mockRequest('50.50.50.50');
    const opts = { max: 1, windowMs: 60000 };
    expect(checkPublicRateLimit(req as any, { ...opts, prefix: 'api' })).toBeNull();
    expect(checkPublicRateLimit(req as any, { ...opts, prefix: 'auth' })).toBeNull();
  });

  it('includes Retry-After header in 429 response', () => {
    const req = mockRequest('99.99.99.99');
    const opts = { max: 1, windowMs: 60000 };
    checkPublicRateLimit(req as any, opts);
    const result = checkPublicRateLimit(req as any, opts)!;
    expect(result.headers.get('Retry-After')).toBeDefined();
    expect(result.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(result.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('falls back to unknown IP when no headers', () => {
    const req = { headers: { get: () => null } };
    const result = checkPublicRateLimit(req as any, { max: 100, windowMs: 60000 });
    expect(result).toBeNull();
  });
});

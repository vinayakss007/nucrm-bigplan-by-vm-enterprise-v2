import { describe, it, expect } from 'vitest';
import { verifySecret } from '@/lib/crypto';

describe('verifySecret', () => {
  it('returns true when secrets match', () => {
    expect(verifySecret('my-secret', 'my-secret')).toBe(true);
  });

  it('returns false when secrets differ', () => {
    expect(verifySecret('my-secret', 'other-secret')).toBe(false);
  });

  it('returns false when provided secret is null', () => {
    expect(verifySecret(null, 'some-secret')).toBe(false);
  });

  it('returns false when expected secret is undefined', () => {
    expect(verifySecret('some-secret', undefined)).toBe(false);
  });

  it('returns false when both are missing', () => {
    expect(verifySecret(null, undefined)).toBe(false);
  });

  it('returns false when lengths differ (timing-safe)', () => {
    expect(verifySecret('short', 'very-long-secret')).toBe(false);
  });

  it('handles empty strings correctly', () => {
    expect(verifySecret('', 'secret')).toBe(false);
    expect(verifySecret('secret', '')).toBe(false);
  });
});

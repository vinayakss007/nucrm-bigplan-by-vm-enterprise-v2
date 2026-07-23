import { describe, it, expect } from 'vitest';

const { getEndpointWindow, RATE_LIMIT_ENDPOINTS } = await import('@/lib/rate-limit');

// ─── RATE_LIMIT_ENDPOINTS ──────────────────────────────────────
describe('RATE_LIMIT_ENDPOINTS', () => {
  it('exports an array of endpoint configs', () => {
    expect(Array.isArray(RATE_LIMIT_ENDPOINTS)).toBe(true);
    expect(RATE_LIMIT_ENDPOINTS.length).toBeGreaterThan(0);
  });

  it('each entry has key, label, window, windowLabel', () => {
    for (const ep of RATE_LIMIT_ENDPOINTS) {
      expect(typeof ep.key).toBe('string');
      expect(typeof ep.label).toBe('string');
      expect(typeof ep.window).toBe('number');
      expect(typeof ep.windowLabel).toBe('string');
    }
  });

  it('contains api endpoint', () => {
    const api = RATE_LIMIT_ENDPOINTS.find(e => e.key === 'api');
    expect(api).toBeDefined();
    expect(api?.window).toBe(60);
  });

  it('contains auth endpoint', () => {
    const auth = RATE_LIMIT_ENDPOINTS.find(e => e.key === 'auth');
    expect(auth).toBeDefined();
    expect(auth?.window).toBe(60);
  });

  it('contains export endpoint with 1-hour window', () => {
    const exp = RATE_LIMIT_ENDPOINTS.find(e => e.key === 'export');
    expect(exp).toBeDefined();
    expect(exp?.window).toBe(3600);
  });

  it('contains ai endpoint with 1-hour window', () => {
    const ai = RATE_LIMIT_ENDPOINTS.find(e => e.key === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.window).toBe(3600);
  });
});

// ─── getEndpointWindow ─────────────────────────────────────────
describe('getEndpointWindow', () => {
  it('returns 60 for api endpoint', () => {
    expect(getEndpointWindow('api')).toBe(60);
  });

  it('returns 60 for auth endpoint', () => {
    expect(getEndpointWindow('auth')).toBe(60);
  });

  it('returns 60 for contacts endpoint', () => {
    expect(getEndpointWindow('contacts')).toBe(60);
  });

  it('returns 60 for deals endpoint', () => {
    expect(getEndpointWindow('deals')).toBe(60);
  });

  it('returns 3600 for export endpoint', () => {
    expect(getEndpointWindow('export')).toBe(3600);
  });

  it('returns 3600 for import endpoint', () => {
    expect(getEndpointWindow('import')).toBe(3600);
  });

  it('returns 3600 for ai endpoint', () => {
    expect(getEndpointWindow('ai')).toBe(3600);
  });

  it('returns 3600 for webhook endpoint', () => {
    expect(getEndpointWindow('webhook')).toBe(3600);
  });

  it('returns 3600 for passwordReset endpoint', () => {
    expect(getEndpointWindow('passwordReset')).toBe(3600);
  });

  it('returns 3600 for emailVerification endpoint', () => {
    expect(getEndpointWindow('emailVerification')).toBe(3600);
  });

  it('returns 3600 for bulk endpoint', () => {
    expect(getEndpointWindow('bulk')).toBe(3600);
  });

  it('returns default 60 for unknown endpoint', () => {
    expect(getEndpointWindow('nonexistent')).toBe(60);
  });

  it('returns default 60 for empty string', () => {
    expect(getEndpointWindow('')).toBe(60);
  });
});

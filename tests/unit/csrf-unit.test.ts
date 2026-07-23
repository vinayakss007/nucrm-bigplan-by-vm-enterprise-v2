 
import { describe, it, expect } from 'vitest';

const {
  generateCsrfToken,
  setCsrfCookie,
  getCsrfTokenFromCookie,
  getCsrfTokenFromHeader,
  validateCsrfToken,
  isSafeMethod,
  needsCsrfValidation,
} = await import('@/lib/auth/csrf');

// ─── generateCsrfToken ─────────────────────────────────────────
describe('generateCsrfToken', () => {
  it('returns a 64-char hex string (32 bytes)', () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates different tokens on each call', () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });
});

// ─── setCsrfCookie ─────────────────────────────────────────────
describe('setCsrfCookie', () => {
  it('builds cookie string with token', () => {
    const result = setCsrfCookie('abc123');
    expect(result).toContain('nucrm_csrf_token=abc123');
    expect(result).toContain('Path=/');
    expect(result).toContain('SameSite=Strict');
    expect(result).toContain('Max-Age=2592000');
  });

  it('includes Secure in production', () => {
    const result = setCsrfCookie('abc123', true);
    expect(result).toContain('; Secure');
  });

  it('excludes Secure in development', () => {
    const result = setCsrfCookie('abc123', false);
    expect(result).not.toContain('; Secure');
  });

  it('excludes Secure by default', () => {
    const result = setCsrfCookie('abc123');
    expect(result).not.toContain('; Secure');
  });
});

// ─── getCsrfTokenFromCookie ────────────────────────────────────
describe('getCsrfTokenFromCookie', () => {
  it('extracts token from cookie header', () => {
    const header = 'other=value; nucrm_csrf_token=xyz789; another=val';
    expect(getCsrfTokenFromCookie(header)).toBe('xyz789');
  });

  it('extracts token at the start of cookie header', () => {
    expect(getCsrfTokenFromCookie('nucrm_csrf_token=first')).toBe('first');
  });

  it('extracts token with no spaces', () => {
    expect(getCsrfTokenFromCookie('nucrm_csrf_token=notoken')).toBe('notoken');
  });

  it('returns null for null header', () => {
    expect(getCsrfTokenFromCookie(null)).toBeNull();
  });

  it('returns null when cookie not present', () => {
    expect(getCsrfTokenFromCookie('other=value')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getCsrfTokenFromCookie('')).toBeNull();
  });
});

// ─── getCsrfTokenFromHeader ────────────────────────────────────
describe('getCsrfTokenFromHeader', () => {
  it('extracts token from default header', () => {
    const headers = new Headers({ 'x-csrf-token': 'header-token' });
    expect(getCsrfTokenFromHeader(headers)).toBe('header-token');
  });

  it('extracts token from custom header name', () => {
    const headers = new Headers({ 'x-custom-csrf': 'custom-val' });
    expect(getCsrfTokenFromHeader(headers, 'x-custom-csrf')).toBe('custom-val');
  });

  it('returns null when header missing', () => {
    const headers = new Headers();
    expect(getCsrfTokenFromHeader(headers)).toBeNull();
  });
});

// ─── validateCsrfToken ─────────────────────────────────────────
describe('validateCsrfToken', () => {
  it('returns true for matching tokens', () => {
    expect(validateCsrfToken('same-token', 'same-token')).toBe(true);
  });

  it('returns false for mismatched tokens', () => {
    expect(validateCsrfToken('token-a', 'token-b')).toBe(false);
  });

  it('returns false when cookie token is null', () => {
    expect(validateCsrfToken(null, 'header-token')).toBe(false);
  });

  it('returns false when header token is null', () => {
    expect(validateCsrfToken('cookie-token', null)).toBe(false);
  });

  it('returns false when both are null', () => {
    expect(validateCsrfToken(null, null)).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(validateCsrfToken('', '')).toBe(false);
  });

  it('returns true for complex tokens with special characters', () => {
    const token = 'abc123!@#$%^&*()_+-=';
    expect(validateCsrfToken(token, token)).toBe(true);
  });
});

// ─── isSafeMethod ──────────────────────────────────────────────
describe('isSafeMethod', () => {
  it('returns true for GET', () => expect(isSafeMethod('GET')).toBe(true));
  it('returns true for HEAD', () => expect(isSafeMethod('HEAD')).toBe(true));
  it('returns true for OPTIONS', () => expect(isSafeMethod('OPTIONS')).toBe(true));
  it('returns true for get (lowercase)', () => expect(isSafeMethod('get')).toBe(true));
  it('returns true for head (lowercase)', () => expect(isSafeMethod('head')).toBe(true));
  it('returns false for POST', () => expect(isSafeMethod('POST')).toBe(false));
  it('returns false for PUT', () => expect(isSafeMethod('PUT')).toBe(false));
  it('returns false for DELETE', () => expect(isSafeMethod('DELETE')).toBe(false));
  it('returns false for PATCH', () => expect(isSafeMethod('PATCH')).toBe(false));
});

// ─── needsCsrfValidation ───────────────────────────────────────
describe('needsCsrfValidation', () => {
  it('returns false for safe methods', () => {
    expect(needsCsrfValidation('GET', '/api/contacts')).toBe(false);
  });

  it('returns false for API key auth', () => {
    expect(needsCsrfValidation('POST', '/api/contacts', 'api_key')).toBe(false);
  });

  it('returns false for webhook routes', () => {
    expect(needsCsrfValidation('POST', '/api/webhooks/stripe')).toBe(false);
  });

  it('returns false for cron routes', () => {
    expect(needsCsrfValidation('POST', '/api/cron/backup')).toBe(false);
  });

  it('returns false for forms routes', () => {
    expect(needsCsrfValidation('POST', '/api/forms/submit')).toBe(false);
  });

  it('returns false for public lead routes', () => {
    expect(needsCsrfValidation('POST', '/api/leads/public/claim')).toBe(false);
  });

  it('returns false for setup routes', () => {
    expect(needsCsrfValidation('POST', '/api/setup/complete')).toBe(false);
  });

  it('returns false for tenant onboarding', () => {
    expect(needsCsrfValidation('POST', '/api/tenant/onboarding')).toBe(false);
  });

  it('returns false for login', () => {
    expect(needsCsrfValidation('POST', '/api/auth/login')).toBe(false);
  });

  it('returns false for signup', () => {
    expect(needsCsrfValidation('POST', '/api/auth/signup')).toBe(false);
  });

  it('returns false for forgot-password', () => {
    expect(needsCsrfValidation('POST', '/api/auth/forgot-password')).toBe(false);
  });

  it('returns false for resend-verification', () => {
    expect(needsCsrfValidation('POST', '/api/auth/resend-verification')).toBe(false);
  });

  it('returns false for verify-email', () => {
    expect(needsCsrfValidation('POST', '/api/auth/verify-email')).toBe(false);
  });

  it('returns true for state-changing non-exempt routes', () => {
    expect(needsCsrfValidation('POST', '/api/contacts')).toBe(true);
  });

  it('returns true for PUT requests', () => {
    expect(needsCsrfValidation('PUT', '/api/deals/123')).toBe(true);
  });

  it('returns true for DELETE requests', () => {
    expect(needsCsrfValidation('DELETE', '/api/contacts/456')).toBe(true);
  });

  it('returns false for PATCH to auth routes', () => {
    expect(needsCsrfValidation('PATCH', '/api/auth/login')).toBe(false);
  });
});

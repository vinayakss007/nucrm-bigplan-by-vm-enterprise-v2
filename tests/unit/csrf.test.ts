import { describe, it, expect } from 'vitest';

describe('auth/csrf', () => {
  it('generateCsrfToken returns a 64-char hex string', async () => {
    const { generateCsrfToken } = await import('@/lib/auth/csrf');
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateCsrfToken produces unique tokens', async () => {
    const { generateCsrfToken } = await import('@/lib/auth/csrf');
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });

  it('setCsrfCookie returns cookie string with token', async () => {
    const { setCsrfCookie } = await import('@/lib/auth/csrf');
    const cookie = setCsrfCookie('test-token');
    expect(cookie).toContain('nucrm_csrf_token=test-token');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).not.toContain('Secure');
  });

  it('setCsrfCookie adds Secure flag in production', async () => {
    const { setCsrfCookie } = await import('@/lib/auth/csrf');
    const cookie = setCsrfCookie('test-token', true);
    expect(cookie).toContain('Secure');
  });

  it('getCsrfTokenFromCookie extracts token from cookie header', async () => {
    const { getCsrfTokenFromCookie } = await import('@/lib/auth/csrf');
    const result = getCsrfTokenFromCookie('nucrm_csrf_token=abc123; other=val');
    expect(result).toBe('abc123');
  });

  it('getCsrfTokenFromCookie returns null for missing header', async () => {
    const { getCsrfTokenFromCookie } = await import('@/lib/auth/csrf');
    expect(getCsrfTokenFromCookie(null)).toBeNull();
    expect(getCsrfTokenFromCookie('')).toBeNull();
  });

  it('getCsrfTokenFromCookie returns null when token not present', async () => {
    const { getCsrfTokenFromCookie } = await import('@/lib/auth/csrf');
    expect(getCsrfTokenFromCookie('other=val')).toBeNull();
  });

  it('getCsrfTokenFromHeader extracts token from Headers', async () => {
    const { getCsrfTokenFromHeader } = await import('@/lib/auth/csrf');
    const headers = new Headers({ 'x-csrf-token': 'header-token' });
    expect(getCsrfTokenFromHeader(headers)).toBe('header-token');
  });

  it('getCsrfTokenFromHeader returns null for missing header', async () => {
    const { getCsrfTokenFromHeader } = await import('@/lib/auth/csrf');
    const headers = new Headers();
    expect(getCsrfTokenFromHeader(headers)).toBeNull();
  });

  it('getCsrfTokenFromHeader accepts custom header name', async () => {
    const { getCsrfTokenFromHeader } = await import('@/lib/auth/csrf');
    const headers = new Headers({ 'x-custom': 'val' });
    expect(getCsrfTokenFromHeader(headers, 'x-custom')).toBe('val');
  });

  it('validateCsrfToken returns true for matching tokens', async () => {
    const { generateCsrfToken, validateCsrfToken } = await import('@/lib/auth/csrf');
    const token = generateCsrfToken();
    expect(validateCsrfToken(token, token)).toBe(true);
  });

  it('validateCsrfToken returns false for mismatched tokens', async () => {
    const { validateCsrfToken } = await import('@/lib/auth/csrf');
    expect(validateCsrfToken('abc', 'def')).toBe(false);
  });

  it('validateCsrfToken returns false when either token is null', async () => {
    const { validateCsrfToken } = await import('@/lib/auth/csrf');
    expect(validateCsrfToken(null, 'header-token')).toBe(false);
    expect(validateCsrfToken('cookie-token', null)).toBe(false);
    expect(validateCsrfToken(null, null)).toBe(false);
  });

  it('validateCsrfToken returns false for tokens with different lengths', async () => {
    const { validateCsrfToken } = await import('@/lib/auth/csrf');
    expect(validateCsrfToken('short', 'muchlonger_token_here')).toBe(false);
  });

  it('isSafeMethod returns true for GET, HEAD, OPTIONS', async () => {
    const { isSafeMethod } = await import('@/lib/auth/csrf');
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('HEAD')).toBe(true);
    expect(isSafeMethod('OPTIONS')).toBe(true);
  });

  it('isSafeMethod returns false for unsafe methods', async () => {
    const { isSafeMethod } = await import('@/lib/auth/csrf');
    expect(isSafeMethod('POST')).toBe(false);
    expect(isSafeMethod('PUT')).toBe(false);
    expect(isSafeMethod('PATCH')).toBe(false);
    expect(isSafeMethod('DELETE')).toBe(false);
  });

  it('isSafeMethod is case-insensitive', async () => {
    const { isSafeMethod } = await import('@/lib/auth/csrf');
    expect(isSafeMethod('get')).toBe(true);
    expect(isSafeMethod('post')).toBe(false);
  });

  it('needsCsrfValidation returns false for safe methods', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('GET', '/api/contacts')).toBe(false);
  });

  it('needsCsrfValidation returns false for api_key auth', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('POST', '/api/contacts', 'api_key')).toBe(false);
  });

  it('needsCsrfValidation returns false for exempt paths', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('POST', '/api/webhooks/stripe')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/cron/daily')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/forms/submit')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/leads/public/capture')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/setup/init')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/tenant/onboarding/step')).toBe(false);
  });

  it('needsCsrfValidation returns false for auth pre-auth routes', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('POST', '/api/auth/login')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/auth/signup')).toBe(false);
    // forgot-password now requires CSRF to prevent cross-site reset spam
    expect(needsCsrfValidation('POST', '/api/auth/forgot-password')).toBe(true);
    expect(needsCsrfValidation('POST', '/api/auth/resend-verification')).toBe(false);
    expect(needsCsrfValidation('POST', '/api/auth/verify-email')).toBe(false);
  });

  it('needsCsrfValidation returns true for other POST routes', async () => {
    const { needsCsrfValidation } = await import('@/lib/auth/csrf');
    expect(needsCsrfValidation('POST', '/api/contacts')).toBe(true);
    expect(needsCsrfValidation('DELETE', '/api/deals/123')).toBe(true);
  });
});

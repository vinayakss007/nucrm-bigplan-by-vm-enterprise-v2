import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1173: the password-reset/confirm endpoint must enforce the SAME password
// policy as validatePassword() (min 12 chars + uppercase + number + special
// char) BEFORE calling resetPassword(), so weak passwords are rejected up front
// with the exact policy message instead of a confusing generic server-side 400.

const mockResetPassword = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@/lib/auth/password-reset', () => ({
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
// Use the real validatePassword so the test asserts the actual server policy.

function makeRequest(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers(),
  } as unknown as import('next/server').NextRequest;
}

describe('POST /api/auth/password-reset/confirm password strength (#1173)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Rate limiter allows the request through (returns no response).
    mockCheckRateLimit.mockResolvedValue(null);
    mockResetPassword.mockResolvedValue({ success: true, message: 'Password reset' });
  });

  it('rejects an 8-char password the server policy would reject, without calling resetPassword', async () => {
    const { POST } = await import('@/app/api/auth/password-reset/confirm/route');
    const res = await POST(makeRequest({ token: 't'.repeat(64), password: 'Passw0r' + '!' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    const passwordIssue = json.details.find((d: { field: string }) => d.field === 'password');
    expect(passwordIssue.message).toContain('12 characters');
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('rejects a long password missing complexity (no special char)', async () => {
    const { POST } = await import('@/app/api/auth/password-reset/confirm/route');
    const res = await POST(makeRequest({ token: 't'.repeat(64), password: 'NoSpecialChar123' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    const passwordIssue = json.details.find((d: { field: string }) => d.field === 'password');
    expect(passwordIssue.message).toContain('special character');
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('accepts a policy-compliant password and calls resetPassword', async () => {
    const { POST } = await import('@/app/api/auth/password-reset/confirm/route');
    const res = await POST(makeRequest({ token: 't'.repeat(64), password: 'Str0ng!Pass#123' }));
    expect(res.status).toBe(200);
    expect(mockResetPassword).toHaveBeenCalledWith('t'.repeat(64), 'Str0ng!Pass#123');
  });
});

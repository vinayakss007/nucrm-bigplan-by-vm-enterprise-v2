import { describe, it, expect, vi, beforeEach } from 'vitest';

// #86: POST_login's JSON path lowercases the address through `loginSchema`, but
// the form path took `formData.get('email')` raw. Blocks are written with
// `email.toLowerCase()` and accounts are stored lowercased, so a form sign-in as
// "Admin@Example.com" skipped its own account lockout and could not find the
// user either.

const mockFindLoginBlocks = vi.fn();
const mockRecordFailedAttempt = vi.fn();
const mockWithAuthLookupContext = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
  limiters: { passwordReset: { check: vi.fn().mockResolvedValue({ allowed: true }) } },
  getRateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/drizzle/db', () => ({ db: {} }));
vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: vi.fn(),
  withTenantContext: vi.fn(),
  withUserContext: vi.fn(),
  setTenantContext: vi.fn(),
  withAuthLookupContext: (...args: unknown[]) => mockWithAuthLookupContext(...args),
}));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/security/brute-force', () => ({
  isBlocked: vi.fn().mockResolvedValue({ blocked: false }),
  findLoginBlocks: (...args: unknown[]) => mockFindLoginBlocks(...args),
  recordFailedAttempt: (...args: unknown[]) => mockRecordFailedAttempt(...args),
  recordSuccessfulLogin: vi.fn(),
}));
vi.mock('@/lib/ip-whitelist', () => ({
  checkLoginIpAllowed: vi.fn().mockResolvedValue({ allowed: true, reason: 'no-whitelist' }),
  invalidateIpWhitelistCache: vi.fn(),
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(),
  sendWebhookNotification: vi.fn(),
  sendTelegram: vi.fn(),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));

function formRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return {
    formData: async () => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return form;
    },
    headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'vitest-form' }),
    url: 'http://localhost/api/auth/login',
    method: 'POST',
    body,
  } as unknown as import('next/server').NextRequest;
}

describe('POST_login normalizes the email on the form path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No account matches, which is enough to exercise both identifier reads.
    mockWithAuthLookupContext.mockResolvedValue([]);
    mockFindLoginBlocks.mockResolvedValue({ ip: { blocked: false }, email: { blocked: false } });
  });

  it('lowercases and trims before checking the block table', async () => {
    const { POST_login } = await import('@/lib/auth/api-handlers');
    await POST_login(formRequest({ email: '  Admin@Example.COM  ', password: 'whatever' }));
    expect(mockFindLoginBlocks).toHaveBeenCalledWith(expect.any(String), 'admin@example.com');
  });

  it('looks the account up by the normalized address', async () => {
    const { POST_login } = await import('@/lib/auth/api-handlers');
    await POST_login(formRequest({ email: 'Alice@Corp.io', password: 'whatever' }));
    expect(mockRecordFailedAttempt).toHaveBeenCalledWith(
      'alice@corp.io',
      expect.any(String),
      expect.any(String),
      'Invalid credentials',
    );
  });

  it('still rejects a form sign-in with no address, before any DB read', async () => {
    const { POST_login } = await import('@/lib/auth/api-handlers');
    const res = await POST_login(formRequest({ email: '   ', password: 'whatever' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=missing_fields');
    expect(mockFindLoginBlocks).not.toHaveBeenCalled();
  });

  it('answers an IP block from the single combined read', async () => {
    mockFindLoginBlocks.mockResolvedValue({
      ip: { blocked: true, blockedUntil: new Date(Date.now() + 60_000), reason: 'too many' },
      email: { blocked: false },
    });
    const { POST_login } = await import('@/lib/auth/api-handlers');
    const res = await POST_login(formRequest({ email: 'a@b.co', password: 'whatever' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=Too+many+login+attempts');
    expect(mockFindLoginBlocks).toHaveBeenCalledTimes(1);
  });
});

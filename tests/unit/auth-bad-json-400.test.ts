import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sentry follow-up: a malformed JSON body threw a raw SyntaxError that each
// handler's catch-all turned into a 500 (and for forgot-password, a Sentry
// capture). POST_login/POST_signup now use readJsonBody() and map
// InvalidJsonBodyError to a 400; forgot-password returns 400 without
// logError() (malformed JSON reveals nothing about account existence).

const mockCheckRateLimit = vi.fn();
const mockLogError = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  limiters: {
    passwordReset: { check: vi.fn().mockResolvedValue({ allowed: true }) },
  },
  getRateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/errors-server', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));
vi.mock('@/drizzle/db', () => ({ db: {} }));
vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: vi.fn(async () => {
    throw new Error('no db in unit test');
  }),
  withTenantContext: vi.fn(),
  withUserContext: vi.fn(),
  withAuthLookupContext: vi.fn(),
  setTenantContext: vi.fn(),
}));
vi.mock('@/lib/modules/auto-install', () => ({ installDefaultModules: vi.fn() }));
vi.mock('@/lib/security/brute-force', () => ({
  isBlocked: vi.fn().mockResolvedValue({ blocked: false }),
  recordFailedAttempt: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(),
  sendWebhookNotification: vi.fn(),
  sendTelegram: vi.fn(),
}));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn() }));

function makeBadJsonRequest() {
  return {
    json: async () => {
      throw new SyntaxError("Unexpected token 'z', \"zz\" is not valid JSON");
    },
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'http://localhost/api/auth/endpoint',
    method: 'POST',
  } as unknown as import('next/server').NextRequest;
}

describe('auth handlers reject malformed JSON with 400, not 500', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(null);
  });

  it('POST_signup returns 400 Invalid JSON body', async () => {
    const { POST_signup } = await import('@/lib/auth/api-handlers');
    const res = await POST_signup(makeBadJsonRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it('POST_login returns 400 Invalid JSON body', async () => {
    const { POST_login } = await import('@/lib/auth/api-handlers');
    const res = await POST_login(makeBadJsonRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it('forgot-password returns 200-shape failure only for parsed requests; malformed JSON gets 400 without a Sentry log', async () => {
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeBadJsonRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

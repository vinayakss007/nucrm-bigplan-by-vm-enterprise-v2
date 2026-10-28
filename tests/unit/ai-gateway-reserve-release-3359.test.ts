/**
 * #3359 — `chat()` admission wiring.
 *
 * The gateway admitted with a bare read (`checkCredits`) and settled
 * unconditionally (`deductCredits`), so concurrent calls all passed the same
 * snapshot and the hard cap overspent. Admission now has to be a *claim*, the
 * settlement has to net that claim out, and every path that claims but never
 * settles has to hand the quota back — otherwise a provider outage silently
 * eats the tenant's balance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
// the gateway's provider calls go through safeFetch; this suite stubs fetch and
// wants the stub reached, so the SSRF guard is bypassed (it has its own suite).
vi.mock('@/lib/security/ssrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/ssrf')>();
  return {
    ...actual,
    safeFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input as string, init)) as typeof actual.safeFetch,
    assertSafeUrl: () => undefined,
    resolveAndValidateIp: async () => undefined,
  };
});

const mockReserve = vi.fn();
const mockDeduct = vi.fn();
const mockRelease = vi.fn();
const mockCheck = vi.fn();
const mockIsCentralized = vi.fn();

vi.mock('@/lib/ai/credits', () => ({
  reserveCredits: (t: string, e: number) => mockReserve(t, e),
  checkCredits: (t: string, e: number) => mockCheck(t, e),
  deductCredits: (p: unknown) => mockDeduct(p),
  releaseCredits: (t: string, r: number) => mockRelease(t, r),
  isCentralizedProvider: (t: string, p: string) => mockIsCentralized(t, p),
}));

const mockGetProviderKey = vi.fn();
vi.mock('@/lib/ai/secrets', () => ({ getProviderKey: mockGetProviderKey }));

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => mockDbSelect()) })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(() => mockDbInsert()) })),
    })),
    query: {
      aiProviderSecrets: { findFirst: vi.fn(async () => null) },
      tenantAiCredits: { findFirst: vi.fn(async () => null) },
    },
  },
}));
vi.mock('@/drizzle/schema/core', () => ({ tenants: { id: 'id', settings: 'settings' } }));
vi.mock('@/drizzle/schema/ai', () => ({
  aiActivity: { id: 'id', tenantId: 'tenant_id' },
  tenantAiCredits: { tenantId: 'tenant_id' },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

let chatFn: typeof import('@/lib/ai/gateway').chat;

const OPENAI_SETTINGS = [{
  settings: {
    ai_providers: {
      openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
      groq: { enabled: false, default_model: 'llama-3.1-70b-versatile', temperature: 0.4, max_tokens: 1024, fallback_priority: 2 },
      ollama: { enabled: false, default_model: 'llama3.1:8b', temperature: 0.4, max_tokens: 1024, fallback_priority: 3, base_url: 'http://localhost:11434' },
    },
  },
}];

const baseReq = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  action: 'draft_email',
  max_tokens: 200,
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

const ALLOWED = { allowed: true, reserved: 200, balance: {}, reason: undefined };

function providerOk() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'Hi there' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      model: 'gpt-4o-mini',
    }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import('@/lib/ai/gateway');
  chatFn = mod.chat;
  mockIsCentralized.mockResolvedValue(true);
  mockReserve.mockResolvedValue(ALLOWED);
  mockDeduct.mockResolvedValue({ success: true, balanceAfter: {} });
  mockRelease.mockResolvedValue(undefined);
  mockCheck.mockResolvedValue({ allowed: true, balance: {} });
  mockGetProviderKey.mockResolvedValue({ plaintext: 'sk-test', baseUrl: null, modelOverride: null, keyType: 'tenant' });
  mockDbSelect.mockResolvedValue(OPENAI_SETTINGS);
  mockDbInsert.mockResolvedValue([{ id: 'act-1' }]);
  providerOk();
});

describe('chat() admits through the claim, not the read (#3359)', () => {
  it('reserves the estimate and never takes the check-then-act path', async () => {
    await chatFn(baseReq);

    expect(mockReserve).toHaveBeenCalledWith('tenant-1', 200);
    expect(mockCheck, 'a bare read cannot gate a hard cap — it is the race itself').not.toHaveBeenCalled();
  });

  it('hands the reservation to the settlement so it is netted out', async () => {
    await chatFn(baseReq);

    expect(mockDeduct).toHaveBeenCalledTimes(1);
    expect(mockDeduct.mock.calls[0][0]).toMatchObject({ reservedTokens: 200 });
    expect(mockRelease, 'a settled call has nothing to give back').not.toHaveBeenCalled();
  });

  it('does not reach the provider when the claim was refused', async () => {
    mockReserve.mockResolvedValue({ allowed: false, reserved: 0, balance: {}, reason: 'Insufficient credits. Remaining: 10 tokens, estimated needed: 200' });

    await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'no_key_for_provider' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  });
});

describe('chat() gives an unsettled claim back (#3359)', () => {
  it('releases when every provider in the chain fails', async () => {
    mockFetch.mockRejectedValue(new Error('socket hang up'));

    await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'all_providers_failed' });

    expect(mockRelease).toHaveBeenCalledWith('tenant-1', 200);
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it('releases when the provider answers a fatal 4xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid request' } }),
      text: async () => '{"error":{"message":"invalid request"}}',
    });

    await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'invalid_request' });

    expect(mockRelease).toHaveBeenCalledWith('tenant-1', 200);
  });

  it('releases when the call was served by a provider that is not centralized', async () => {
    // admission was gated on the *requested* pool; the fallback that served the
    // call bills itself, so the reservation must not stick to the pool
    mockIsCentralized
      .mockResolvedValueOnce(true)    // req.provider pool check at admission
      .mockResolvedValueOnce(false);  // the provider that actually served it

    await chatFn(baseReq);

    expect(mockDeduct).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith('tenant-1', 200);
  });

  it('releases when the settlement itself failed — a rolled-back transaction billed nothing', async () => {
    mockDeduct.mockResolvedValue({ success: false, balanceAfter: {}, error: 'db down' });

    await chatFn(baseReq);

    expect(mockRelease).toHaveBeenCalledWith('tenant-1', 200);
  });

  it('releases nothing when the tenant is soft-capped and no quota was claimed', async () => {
    mockReserve.mockResolvedValue({ allowed: true, reserved: 0, balance: {}, reason: undefined });

    await chatFn(baseReq);

    expect(mockRelease, 'reserved = 0 has nothing to give back').not.toHaveBeenCalled();
  });
});

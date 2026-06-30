import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockGetProviderKey = vi.fn();

vi.mock('@/lib/ai/secrets', () => ({
  getProviderKey: mockGetProviderKey,
}));

const mockFrom = vi.fn(() => ({
  where: vi.fn(() => ({
    limit: vi.fn(() => mockDbSelect()),
  })),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => mockDbInsert()),
      })),
    })),
    query: {
      aiProviderSecrets: { findFirst: vi.fn(async () => null) },
      tenantAiCredits: { findFirst: vi.fn(async () => null) },
      tenants: { findFirst: vi.fn(async () => null) },
    },
  },
}));

vi.mock('@/drizzle/schema/core', () => ({
  tenants: { id: 'id', settings: 'settings', name: 'name', primaryColor: 'primary_color' },
}));

vi.mock('@/drizzle/schema/ai', () => ({
  aiActivity: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', action: 'action', provider: 'provider', model: 'model', status: 'status', tokensIn: 'tokens_in', tokensOut: 'tokens_out', tokensUsed: 'tokens_used', costCents: 'cost_cents', latencyMs: 'latency_ms', entityType: 'entity_type', entityId: 'entity_id', errorMessage: 'error_message', metadata: 'metadata' },
  aiProviderSecrets: { tenantId: 'tenant_id', provider: 'provider', isCentralized: 'is_centralized' },
  tenantAiCredits: { tenantId: 'tenant_id', billingPeriod: 'billing_period', allocatedTokens: 'allocated_tokens', usedTokens: 'used_tokens' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  sql: Object.assign(vi.fn(() => ({ type: 'sql' })), { raw: vi.fn() }),
}));

global.fetch = mockFetch;

let GatewayErrorClass: typeof import('@/lib/ai/gateway').GatewayError;
let chatFn: typeof import('@/lib/ai/gateway').chat;
let completeFn: typeof import('@/lib/ai/gateway').complete;

describe('AI Gateway', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/lib/ai/gateway');
    GatewayErrorClass = mod.GatewayError;
    chatFn = mod.chat;
    completeFn = mod.complete;
  });

  describe('GatewayError', () => {
    it('creates error with correct code and message', () => {
      const err = new GatewayErrorClass('no_provider_enabled', 'No provider');
      expect(err.code).toBe('no_provider_enabled');
      expect(err.message).toBe('No provider');
      expect(err.name).toBe('GatewayError');
    });

    it('creates error with provider and status', () => {
      const err = new GatewayErrorClass('no_key_for_provider', 'No key', { provider: 'openai', status: 401 });
      expect(err.provider).toBe('openai');
      expect(err.status).toBe(401);
    });
  });

  describe('chat', () => {
    const baseReq = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'draft_email',
      messages: [{ role: 'user' as const, content: 'Hello' }],
    };

    beforeEach(() => {
      mockFrom.mockClear();
    });

    it('throws invalid_request when messages is empty', async () => {
      await expect(chatFn({ ...baseReq, messages: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('throws invalid_request when messages is not an array', async () => {
      await expect(chatFn({ ...baseReq, messages: undefined as unknown as [] })).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('throws no_provider_enabled when no providers configured', async () => {
      mockDbSelect.mockResolvedValueOnce([{ settings: {} }]);
      await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'no_provider_enabled' });
    });

    it('throws no_provider_enabled when all providers are disabled', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: false },
            anthropic: { enabled: false },
            groq: { enabled: false },
            ollama: { enabled: false },
          },
        },
      }]);
      await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'no_provider_enabled' });
    });

    it('succeeds with OpenAI provider and returns response', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
            anthropic: { enabled: false, default_model: 'claude-3-5-sonnet-latest', temperature: 0.4, max_tokens: 1024, fallback_priority: 2 },
            groq: { enabled: false, default_model: 'llama-3.1-70b-versatile', temperature: 0.4, max_tokens: 1024, fallback_priority: 3 },
            ollama: { enabled: false, default_model: 'llama3.1:8b', temperature: 0.4, max_tokens: 1024, fallback_priority: 4, base_url: 'http://localhost:11434' },
          },
        },
      }]);

      mockGetProviderKey.mockResolvedValueOnce({ plaintext: 'sk-test-key', baseUrl: null });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello! How can I help?' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
          model: 'gpt-4o-mini',
        }),
      });
      mockDbInsert.mockResolvedValueOnce([{ id: 'act-1' }]);

      const result = await chatFn(baseReq);

      expect(result.text).toBe('Hello! How can I help?');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.tokensIn).toBe(10);
      expect(result.tokensOut).toBe(20);
      expect(result.fallbacksUsed).toBe(0);
      expect(result.activityId).toBe('act-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer sk-test-key' }),
        }),
      );
    });

    it('falls back to next provider when first fails with 5xx', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
            anthropic: { enabled: true, default_model: 'claude-3-5-sonnet-latest', temperature: 0.4, max_tokens: 1024, fallback_priority: 2 },
            groq: { enabled: false },
            ollama: { enabled: false, base_url: 'http://localhost:11434' },
          },
        },
      }]);

      mockGetProviderKey
        .mockResolvedValueOnce({ plaintext: 'sk-openai', baseUrl: null })
        .mockResolvedValueOnce({ plaintext: 'sk-anthropic', baseUrl: null });

      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 502, text: async () => 'Bad Gateway',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ text: 'Anthropic fallback' }],
            usage: { input_tokens: 15, output_tokens: 25 },
            model: 'claude-3-5-sonnet-latest',
          }),
        });

      mockDbInsert
        .mockResolvedValueOnce([{ id: 'act-fail' }])
        .mockResolvedValueOnce([{ id: 'act-success' }]);

      const result = await chatFn(baseReq);
      expect(result.text).toBe('Anthropic fallback');
      expect(result.provider).toBe('anthropic');
      expect(result.fallbacksUsed).toBe(1);
    });

    it('bails on 4xx non-auth errors', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
          },
        },
      }]);

      mockGetProviderKey.mockResolvedValueOnce({ plaintext: 'sk-test', baseUrl: null });
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 400, text: async () => 'Bad Request',
      });
      mockDbInsert.mockResolvedValueOnce([{ id: 'act-err' }]);

      await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('skips provider when vault key fetch fails and continues chain', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
            anthropic: { enabled: true, default_model: 'claude-3-5-sonnet-latest', temperature: 0.4, max_tokens: 1024, fallback_priority: 2 },
          },
        },
      }]);

      mockGetProviderKey
        .mockRejectedValueOnce(new Error('vault error'))
        .mockResolvedValueOnce({ plaintext: 'sk-anthropic', baseUrl: null });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Anthropic response' }],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: 'claude-3-5-sonnet-latest',
        }),
      });

      mockDbInsert
        .mockResolvedValueOnce([{ id: 'act-err' }])
        .mockResolvedValueOnce([{ id: 'act-success' }]);

      const result = await chatFn(baseReq);
      expect(result.provider).toBe('anthropic');
      expect(result.fallbacksUsed).toBe(1);
    });

    it('skips non-ollama provider when no key stored', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
            ollama: { enabled: true, default_model: 'llama3.1:8b', temperature: 0.4, max_tokens: 1024, fallback_priority: 2, base_url: 'http://localhost:11434' },
          },
        },
      }]);

      mockGetProviderKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ plaintext: '', baseUrl: 'http://localhost:11434' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Ollama response' },
          prompt_eval_count: 10, eval_count: 20, model: 'llama3.1:8b',
        }),
      });

      mockDbInsert.mockResolvedValueOnce([{ id: 'act-ollama' }]);

      const result = await chatFn(baseReq);
      expect(result.provider).toBe('ollama');
      expect(result.fallbacksUsed).toBe(1);
    });

    it('passes system prompt and entity metadata to provider', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true, default_model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
          },
        },
      }]);

      mockGetProviderKey.mockResolvedValueOnce({ plaintext: 'sk-test', baseUrl: null });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
          model: 'gpt-4o-mini',
        }),
      });
      mockDbInsert.mockResolvedValueOnce([{ id: 'act-entity' }]);

      await chatFn({
        ...baseReq, system: 'You are helpful.',
        entityType: 'contact', entityId: 'contact-1', metadata: { source: 'test' },
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.messages[0].role).toBe('system');
      expect(fetchBody.messages[0].content).toBe('You are helpful.');
    });

    it('throws all_providers_failed when every provider fails', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true },
            anthropic: { enabled: true },
          },
        },
      }]);

      mockGetProviderKey
        .mockResolvedValueOnce({ plaintext: 'sk-1', baseUrl: null })
        .mockResolvedValueOnce({ plaintext: 'sk-2', baseUrl: null });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'Bad' })
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Unavailable' });

      mockDbInsert
        .mockResolvedValueOnce([{ id: 'f1' }])
        .mockResolvedValueOnce([{ id: 'f2' }]);

      await expect(chatFn(baseReq)).rejects.toMatchObject({ code: 'all_providers_failed' });
    });

    it('handles 429 as rate_limited and continues chain', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true },
            anthropic: { enabled: true },
          },
        },
      }]);

      mockGetProviderKey
        .mockResolvedValueOnce({ plaintext: 'sk-1', baseUrl: null })
        .mockResolvedValueOnce({ plaintext: 'sk-2', baseUrl: null });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limit' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ text: 'Fallback' }],
            usage: { input_tokens: 10, output_tokens: 10 },
            model: 'claude-3-5-sonnet-latest',
          }),
        });

      mockDbInsert
        .mockResolvedValueOnce([{ id: 'act-rate' }])
        .mockResolvedValueOnce([{ id: 'act-ok' }]);

      const result = await chatFn(baseReq);
      expect(result.provider).toBe('anthropic');
      expect(result.fallbacksUsed).toBe(1);
    });

    it('logs activity even when insert fails', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true },
          },
        },
      }]);

      mockGetProviderKey.mockResolvedValueOnce({ plaintext: 'sk-test', baseUrl: null });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
          model: 'gpt-4o-mini',
        }),
      });
      mockDbInsert.mockRejectedValueOnce(new Error('DB error'));

      const result = await chatFn(baseReq);
      expect(result.activityId).toBeNull();
      expect(result.text).toBe('Response');
    });

    it('uses Groq via OpenAI-compatible endpoint', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            groq: { enabled: true, default_model: 'llama-3.1-70b-versatile', temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
          },
        },
      }]);

      mockGetProviderKey.mockResolvedValueOnce({ plaintext: 'gsk-test', baseUrl: null });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Groq response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
          model: 'llama-3.1-70b-versatile',
        }),
      });
      mockDbInsert.mockResolvedValueOnce([{ id: 'act-groq' }]);

      const result = await chatFn(baseReq);
      expect(result.provider).toBe('groq');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions', expect.any(Object),
      );
    });
  });

  describe('complete', () => {
    it('wraps user string in message array and calls chat', async () => {
      mockDbSelect.mockResolvedValueOnce([{
        settings: {
          ai_providers: {
            openai: { enabled: true },
          },
        },
      }]);

      mockGetProviderKey.mockResolvedValueOnce({ plaintext: 'sk-test', baseUrl: null });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Done' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
          model: 'gpt-4o-mini',
        }),
      });
      mockDbInsert.mockResolvedValueOnce([{ id: 'act-c' }]);

      const result = await completeFn({
        tenantId: 't-1', userId: 'u-1', action: 'complete',
        system: 'Helpful', user: 'Tell me',
      });

      expect(result.text).toBe('Done');
    });
  });
});

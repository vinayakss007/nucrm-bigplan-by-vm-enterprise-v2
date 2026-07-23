import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/integrations/providers/sendgrid', () => ({
  sendgridProvider: { id: 'sendgrid', name: 'SendGrid' },
}));
vi.mock('@/lib/integrations/providers/slack', () => ({
  slackProvider: { id: 'slack', name: 'Slack' },
}));
vi.mock('@/lib/integrations/providers/mailgun', () => ({
  mailgunProvider: { id: 'mailgun', name: 'Mailgun' },
}));
vi.mock('@/lib/integrations/providers/openai', () => ({
  openaiProvider: { id: 'openai', name: 'OpenAI' },
}));
vi.mock('@/lib/integrations/ai-connector', () => ({
  aiConnector: vi.fn(),
}));

describe('Integration Registry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('getProviderDef', () => {
    it('returns provider definition by id', async () => {
      const { getProviderDef } = await import('@/lib/integrations/registry');
      const provider = getProviderDef('sendgrid');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('sendgrid');
    });

    it('returns undefined for unknown provider', async () => {
      const { getProviderDef } = await import('@/lib/integrations/registry');
      expect(getProviderDef('unknown')).toBeUndefined();
    });
  });

  describe('getAllProviders', () => {
    it('returns all built-in providers', async () => {
      const { getAllProviders } = await import('@/lib/integrations/registry');
      const providers = getAllProviders();
      expect(providers).toHaveLength(4);
      expect(providers.map(p => p.id)).toEqual(['sendgrid', 'slack', 'mailgun', 'openai']);
    });
  });

  describe('executeAction', () => {
    const baseInstance = {
      id: 'inst-1',
      providerId: 'sendgrid',
      config: { api_key: 'sk-test', from_email: 'test@example.com', from_name: 'Test' },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('returns error for unknown action on known provider', async () => {
      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(baseInstance, 'unknown_action', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('returns error when required params missing for sendgrid send_email', async () => {
      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(baseInstance, 'send_email', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('falls back to AI connector for unknown provider', async () => {
      const { aiConnector } = await import('@/lib/integrations/ai-connector');
      (aiConnector as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: { result: 'ai-done' } });

      const { executeAction } = await import('@/lib/integrations/registry');
      const instance = { ...baseInstance, providerId: 'custom-api' };
      const result = await executeAction(instance, 'custom_action', { key: 'val' });
      expect(result.success).toBe(true);
      expect(aiConnector).toHaveBeenCalled();
    });

    it('returns AI connector error on failure', async () => {
      const { aiConnector } = await import('@/lib/integrations/ai-connector');
      (aiConnector as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API unreachable'));

      const { executeAction } = await import('@/lib/integrations/registry');
      const instance = { ...baseInstance, providerId: 'custom-api' };
      const result = await executeAction(instance, 'custom_action', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('AI connector failed');
    });
  });

  describe('SendGrid handler', () => {
    const instance = {
      id: 'inst-1',
      providerId: 'sendgrid',
      config: { api_key: 'sk-test', from_email: 'test@example.com', from_name: 'Test' },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('handles send_email action', async () => {
      const mockResponse = { ok: true, headers: new Map([['x-message-id', 'msg-123']]), text: vi.fn() };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'send_email', { to: 'user@test.com', subject: 'Hello', body: '<p>content</p>' });
      expect(result.success).toBe(true);
    });

    it('handles send_email API error', async () => {
      const mockResponse = { ok: false, status: 401, text: vi.fn().mockResolvedValue('Unauthorized') };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'send_email', { to: 'user@test.com', subject: 'Hello', body: 'content' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('SendGrid API error');
    });

    it('handles add_contact action', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ id: 'contact-1' }) };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'add_contact', { email: 'new@test.com', first_name: 'John' });
      expect(result.success).toBe(true);
    });
  });

  describe('Slack handler', () => {
    const instance = {
      id: 'inst-2',
      providerId: 'slack',
      config: { bot_token: 'xoxb-test', default_channel: '#general' },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('handles send_message action', async () => {
      const mockResponse = { json: vi.fn().mockResolvedValue({ ok: true }) };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'send_message', { text: 'Hello', channel: '#random' });
      expect(result.success).toBe(true);
    });

    it('returns error for missing channel and text', async () => {
      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'send_message', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  describe('Mailgun handler', () => {
    const instance = {
      id: 'inst-3',
      providerId: 'mailgun',
      config: { api_key: 'key-test', domain: 'mg.example.com', from_email: 'noreply@example.com', from_name: 'Mailgun Test' },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('handles send_email action', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ id: '<2024@mg.example.com>' }) };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'send_email', { to: 'user@example.com', subject: 'Test', body: 'content' });
      expect(result.success).toBe(true);
    });
  });

  describe('OpenAI handler', () => {
    const instance = {
      id: 'inst-4',
      providerId: 'openai',
      config: { api_key: 'sk-openai-test', model: 'gpt-4o-mini' },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('handles generate action', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Hello from AI' } }] }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'generate', { prompt: 'Say hello' });
      expect(result.success).toBe(true);
      expect(result.data?.text).toBe('Hello from AI');
    });

    it('handles summarize action', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Summary text' } }] }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'summarize', { text: 'Long text to summarize...' });
      expect(result.success).toBe(true);
      expect(result.data?.summary).toBe('Summary text');
    });

    it('handles draft_email action', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Drafted email body' } }] }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'draft_email', { context: 'Previous conversation...', tone: 'friendly' });
      expect(result.success).toBe(true);
      expect(result.data?.draft).toBe('Drafted email body');
    });

    it('handles OpenAI API error', async () => {
      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({ error: { message: 'Insufficient quota' } }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { executeAction } = await import('@/lib/integrations/registry');
      const result = await executeAction(instance, 'generate', { prompt: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient quota');
    });
  });
});

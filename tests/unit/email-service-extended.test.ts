import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('email/service - Extended', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('sendEmail with Resend', () => {
    it('sends via Resend when configured', async () => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.NODE_ENV = 'production';

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'resend-msg-1' }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Resend Test',
        html: '<p>test</p>',
      });
      expect(result.success).toBe(true);
      expect(result.provider).toBe('resend');
    });

    it('fails when Resend returns error and SMTP not configured', async () => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.NODE_ENV = 'production';

      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ message: 'Invalid API key' }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Fail Test',
        html: '<p>test</p>',
      });
      expect(result.success).toBe(false);
    });

    it('fails in production when no provider works', async () => {
      process.env.NODE_ENV = 'production';
      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'No Provider',
        html: '<p>test</p>',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No email provider configured');
    });
  });

  describe('sendViaSMTP', () => {
    it('tries SMTP fallback when Resend fails but SMTP not configured', async () => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.NODE_ENV = 'production';

      const mockResponse = {
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({}),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Fallback Test',
        html: '<p>test</p>',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sendTelegram', () => {
    it('sends message to Telegram API', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ ok: true }) };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendTelegram } = await import('@/lib/email/service');
      await expect(sendTelegram({
        botToken: '123:ABC',
        chatId: 'chat-1',
        title: 'Alert',
        message: 'Something happened',
      })).resolves.not.toThrow();
    });

    it('handles Telegram API error', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ description: 'Bad Request: chat not found' }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendTelegram } = await import('@/lib/email/service');
      await expect(sendTelegram({
        botToken: '123:ABC',
        chatId: 'invalid',
        title: 'Test',
        message: 'Test message',
      })).resolves.not.toThrow();
    });

    it('handles Telegram fetch throw', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

      const { sendTelegram } = await import('@/lib/email/service');
      await expect(sendTelegram({
        botToken: '123:ABC',
        chatId: 'chat-1',
        title: 'Test',
        message: 'Test',
      })).resolves.not.toThrow();
    });
  });

  describe('sendWebhookNotification', () => {
    it('sends to Discord webhook', async () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
      const mockResponse = { ok: true, json: vi.fn() };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendWebhookNotification } = await import('@/lib/email/service');
      await expect(sendWebhookNotification({
        title: 'Test',
        message: 'Discord test',
      })).resolves.not.toThrow();
    });

    it('sends to Slack webhook', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
      const mockResponse = { ok: true, json: vi.fn() };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const { sendWebhookNotification } = await import('@/lib/email/service');
      await expect(sendWebhookNotification({
        title: 'Test',
        message: 'Slack test',
      })).resolves.not.toThrow();
    });

    it('sends to both Discord and Slack', async () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
      const mockResponse = { ok: true, json: vi.fn() };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const { sendWebhookNotification } = await import('@/lib/email/service');
      await expect(sendWebhookNotification({
        title: 'Both',
        message: 'Both platforms',
        color: '#ff0000',
        url: 'https://example.com',
      })).resolves.not.toThrow();
    });

    it('handles Discord fetch error gracefully', async () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Discord unreachable'));

      const { sendWebhookNotification } = await import('@/lib/email/service');
      await expect(sendWebhookNotification({
        title: 'Test',
        message: 'Should not throw',
      })).resolves.not.toThrow();
    });
  });

  describe('sendTelegramToUser', () => {
    it('does nothing when user has no Telegram enabled', async () => {
      vi.mock('@/drizzle/db', () => ({
        db: {
          query: {
            users: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          },
        },
      }));
      vi.mock('@/drizzle/schema', () => ({ users: {} }));
      vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

      const { sendTelegramToUser } = await import('@/lib/email/service');
      await expect(sendTelegramToUser({
        userId: 'user-1',
        title: 'Test',
        message: 'Message',
      })).resolves.not.toThrow();
    });
  });

  describe('createEmailTracking', () => {
    it('returns null when import fails', async () => {
      const { createEmailTracking } = await import('@/lib/email/service');
      const result = await createEmailTracking({
        tenantId: 't1',
        contactId: 'c1',
        recipient: 'test@example.com',
        subject: 'Test',
      });
      expect(result).toBeNull();
    });
  });
});

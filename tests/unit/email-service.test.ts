import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('email/service', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM_NAME;
    delete process.env.SMTP_FROM_EMAIL;
    delete process.env.NODE_ENV;
    delete process.env.SUPER_ADMIN_EMAIL;
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('sendEmail', () => {
    it('uses console in dev mode when no provider configured', async () => {
      process.env.NODE_ENV = 'development';
      const { sendEmail } = await import('@/lib/email/service');
      
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });
      
      expect(result.success).toBe(true);
      expect(result.provider).toBe('console (dev)');
    });

    it('fails when no provider in production', async () => {
      process.env.NODE_ENV = 'production';
      const { sendEmail } = await import('@/lib/email/service');
      
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No email provider configured');
    });

    it('handles array of recipients', async () => {
      process.env.NODE_ENV = 'development';
      const { sendEmail } = await import('@/lib/email/service');
      
      const result = await sendEmail({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test',
        html: '<p>Test</p>',
      });
      
      expect(result.success).toBe(true);
    });
  });

  describe('renderTemplate', () => {
    it('replaces template variables', async () => {
      const { renderTemplate } = await import('@/lib/email/service');
      
      const result = renderTemplate(
        'Hello {{name}}, your order {{orderId}} is ready',
        { name: 'John', orderId: '12345' }
      );
      
      expect(result).toBe('Hello John, your order 12345 is ready');
    });

    it('handles missing variables with empty string', async () => {
      const { renderTemplate } = await import('@/lib/email/service');
      
      const result = renderTemplate('Hello {{name}}', {});
      expect(result).toBe('Hello ');
    });

    it('handles multiple occurrences', async () => {
      const { renderTemplate } = await import('@/lib/email/service');
      
      const result = renderTemplate('{{name}} {{name}}', { name: 'John' });
      expect(result).toBe('John John');
    });
  });

  describe('alertSuperAdmin', () => {
    it('does nothing when SUPER_ADMIN_EMAIL not set', async () => {
      const { alertSuperAdmin } = await import('@/lib/email/service');
      
      await expect(alertSuperAdmin('Test', 'Message')).resolves.not.toThrow();
    });

    it('sends email to super admin when configured', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@example.com';
      process.env.NODE_ENV = 'development';
      
      const { alertSuperAdmin } = await import('@/lib/email/service');
      
      await expect(alertSuperAdmin('Critical Error', 'DB down')).resolves.not.toThrow();
    });
  });

  describe('sendWebhookNotification', () => {
    it('does nothing when no webhooks configured', async () => {
      const { sendWebhookNotification } = await import('@/lib/email/service');
      
      await expect(sendWebhookNotification({
        title: 'Test',
        message: 'Message',
      })).resolves.not.toThrow();
    });
  });

  describe('sendTelegram', () => {
    it('does nothing when botToken or chatId missing', async () => {
      const { sendTelegram } = await import('@/lib/email/service');
      
      await expect(sendTelegram({
        botToken: '',
        chatId: '123',
        title: 'Test',
        message: 'Message',
      })).resolves.not.toThrow();
      
      await expect(sendTelegram({
        botToken: 'token',
        chatId: '',
        title: 'Test',
        message: 'Message',
      })).resolves.not.toThrow();
    });
  });

  describe('addTracking', () => {
    it('adds tracking pixel to HTML', async () => {
      const { addTracking } = await import('@/lib/email/service');
      
      const html = '<html><body><p>Content</p></body></html>';
      const result = addTracking(html, 'track-123', 'https://app.example.com');
      
      expect(result).toContain('track/open?id=track-123');
      expect(result).toContain('<img');
    });

    it('replaces closing body tag', async () => {
      const { addTracking } = await import('@/lib/email/service');
      
      const html = '<body>Content</body>';
      const result = addTracking(html, 'abc', 'https://app.com');
      
      expect(result).toMatch(/<img[^>]+\/><\/body>$/);
    });
  });

  describe('createEmailTracking', () => {
    it('function is defined', async () => {
      const { createEmailTracking } = await import('@/lib/email/service');
      expect(createEmailTracking).toBeDefined();
      expect(typeof createEmailTracking).toBe('function');
    });
  });
});

describe('email/mock-service', () => {
  it('exports emailService', async () => {
    const mod = await import('@/lib/email/mock-service');
    expect(mod.emailService || mod.default).toBeDefined();
  });

  it('exports createEmailService', async () => {
    const { createEmailService } = await import('@/lib/email/mock-service');
    expect(createEmailService).toBeDefined();
  });
});

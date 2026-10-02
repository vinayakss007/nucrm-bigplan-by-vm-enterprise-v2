import { describe, it, expect, vi, beforeEach } from 'vitest';

// reportEmailFailure reaches for this dynamically. Mocked so the missing-provider
// path can be counted instead of trying to write error_logs from the test DB.
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));

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

    it('reports a missing provider once, at warning level, not per send', async () => {
      // Every transactional email in a provider-less production build hit the
      // same line, so it wrote 42 error-level rows across two days — drowning
      // the real failures in error_logs and Sentry. The state is still recorded
      // (it must not go silent, #1041) but once, and at the severity a missing
      // env var actually has.
      process.env.NODE_ENV = 'production';
      const { sendEmail } = await import('@/lib/email/service');
      const { logError } = await import('@/lib/errors-server');

      for (const subject of ['Reset your password', 'Welcome aboard', 'Trial expiring']) {
        const result = await sendEmail({ to: 'test@example.com', subject, html: '<p>x</p>' });
        expect(result.success).toBe(false);
      }

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'email:send-failure',
          level: 'warning',
        })
      );
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

  describe('isEmailConfigured / getEmailProviderStatus (#1041)', () => {
    it('reports not configured when neither Resend nor SMTP is set', async () => {
      const { isEmailConfigured, getEmailProviderStatus } = await import('@/lib/email/service');
      expect(isEmailConfigured()).toBe(false);
      process.env.NODE_ENV = 'production';
      expect(getEmailProviderStatus()).toEqual({ configured: false, provider: 'none' });
    });

    it('reports resend when RESEND_API_KEY is set', async () => {
      process.env.RESEND_API_KEY = 're_test_123';
      const { isEmailConfigured, getEmailProviderStatus } = await import('@/lib/email/service');
      expect(isEmailConfigured()).toBe(true);
      expect(getEmailProviderStatus()).toEqual({ configured: true, provider: 'resend' });
    });

    it('reports smtp when only SMTP_HOST is set', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { getEmailProviderStatus } = await import('@/lib/email/service');
      expect(getEmailProviderStatus()).toEqual({ configured: true, provider: 'smtp' });
    });

    it('reports console(dev) when unconfigured outside production', async () => {
      process.env.NODE_ENV = 'development';
      const { getEmailProviderStatus } = await import('@/lib/email/service');
      expect(getEmailProviderStatus()).toEqual({ configured: false, provider: 'console (dev)' });
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
      const { addTracking } = await import('@/lib/email/tracking');
      
      const html = '<html><body><p>Content</p></body></html>';
      const result = addTracking(html, 'track-123', 'https://app.example.com');
      
      expect(result).toContain('https://app.example.com/api/track/open?t=track-123');
      expect(result).toContain('<img');
    });

    it('replaces closing body tag', async () => {
      const { addTracking } = await import('@/lib/email/tracking');
      
      const html = '<body>Content</body>';
      const result = addTracking(html, 'abc', 'https://app.com');
      
      expect(result).toMatch(/<img[^>]+\/><\/body>$/);
    });

    /**
     * The pixel is a URL handed to a mail client, and the only thing that proves
     * it works is the route it points at. A previous version rendered
     * `/api/email/track/open?id=`, which matched no route: it fell through the
     * auth middleware with a 401, so every sequence email recorded zero opens
     * while the send itself reported success. This reads the route tree instead
     * of restating the string, so path and query-name drift both fail here.
     */
    it('points at a real public route that reads the id under the same name', async () => {
      const { readFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const { addTracking } = await import('@/lib/email/tracking');

      const html = addTracking('<html><body>X</body></html>', 'track-123', 'https://app.example.com');
      const src = html.match(/src="([^"]+)"/)?.[1];
      expect(src).toBeTruthy();

      const url = new URL(src!);
      expect(url.hostname).toBe('app.example.com');
      // Tenant-scoped routes require auth, and a mail client rendering an image
      // carries no session — the pixel endpoint is necessarily public.
      expect(url.pathname.startsWith('/api/tenant/')).toBe(false);

      const routeFile = join(process.cwd(), 'app', ...url.pathname.split('/').filter(Boolean), 'route.ts');
      expect(existsSync(routeFile), `no route serves ${url.pathname}`).toBe(true);

      const routeSource = readFileSync(routeFile, 'utf8');
      for (const param of url.searchParams.keys()) {
        expect(routeSource, `${url.pathname} never reads ?${param}=`).toContain(`get('${param}')`);
      }
    });
  });

  describe('createEmailTracking', () => {
    it('function is defined', async () => {
      const { createEmailTracking } = await import('@/lib/email/tracking');
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

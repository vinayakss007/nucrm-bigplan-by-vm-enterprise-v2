import { describe, it, expect, vi, beforeEach } from 'vitest';

const API_KEYS = {
  RESEND_API_KEY: 're_123456',
  BREVO_API_KEY: 'brevo_abc789',
  SENDGRID_API_KEY: 'SG.xyz_456',
};

describe('email/router', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SMTP_HOST;
    delete process.env.BREVO_SMTP_PORT;
    delete process.env.BREVO_SMTP_USER;
    delete process.env.BREVO_SMTP_PASS;
    delete process.env.SENDGRID_API_KEY;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('sendSmartEmail', () => {
    it('throws error when no providers configured (no API keys)', async () => {
      const { sendSmartEmail } = await import('@/lib/email/router');
      await expect(sendSmartEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>test</p>',
      })).rejects.toThrow('No email providers available');
    });

    it('sends via Resend for critical emails (highest priority)', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;
      process.env.BREVO_API_KEY = API_KEYS.BREVO_API_KEY;
      process.env.SENDGRID_API_KEY = API_KEYS.SENDGRID_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_123' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'user@example.com',
        type: 'critical',
        subject: 'Critical alert',
        html: '<p>urgent</p>',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('Resend');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
      expect(callBody.to).toBe('user@example.com');
    });

    it('sends via Brevo when Resend not configured', async () => {
      process.env.BREVO_API_KEY = API_KEYS.BREVO_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messageId: 'brevo_001' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'user@example.com',
        type: 'transactional',
        subject: 'Your invoice',
        html: '<p>invoice</p>',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('Brevo');
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email');
    });

    it('sends via SendGrid when higher priority providers unavailable', async () => {
      process.env.SENDGRID_API_KEY = API_KEYS.SENDGRID_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'user@example.com',
        type: 'marketing',
        subject: 'Newsletter',
        html: '<p>news</p>',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('SendGrid');
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.sendgrid.com/v3/mail/send');
    });

    it('falls back to next provider when critical email fails', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;
      process.env.BREVO_API_KEY = API_KEYS.BREVO_API_KEY;

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Resend server error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messageId: 'brevo_002' }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'user@example.com',
        type: 'critical',
        subject: 'Critical fallback',
        html: '<p>fallback</p>',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('Brevo');
    });

    it('throws if all providers fail for non-critical email', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Resend error',
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      await expect(sendSmartEmail({
        to: 'user@example.com',
        type: 'marketing',
        subject: 'Fail',
        html: '<p>fail</p>',
      })).rejects.toThrow('Resend error');
    });

    it('uses default transactional type when none specified', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_456' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'user@example.com',
        subject: 'No type',
        html: '<p>no type</p>',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('Resend');
    });

    it('respects daily and monthly limits', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;
      process.env.SENDGRID_API_KEY = API_KEYS.SENDGRID_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_789' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail, getEmailUsage } = await import('@/lib/email/router');

      // Exhaust Resend daily limit (100)
      const promises = Array.from({ length: 100 }, (_, i) =>
        sendSmartEmail({
          to: `user${i}@example.com`,
          type: 'transactional',
          subject: `Email ${i}`,
          html: '<p>test</p>',
        })
      );
      await Promise.all(promises);

      const usage = getEmailUsage();
      expect(usage.resend.sentToday).toBe(100);
      expect(usage.resend.sentThisMonth).toBe(100);

      // Next email should fall through to SendGrid
      const result = await sendSmartEmail({
        to: 'overflow@example.com',
        type: 'transactional',
        subject: 'Overflow',
        html: '<p>overflow</p>',
      });

      expect(result.provider).toBe('SendGrid');
    });
  });

  describe('getEmailUsage', () => {
    it('returns usage stats for all providers', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_001' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail, getEmailUsage } = await import('@/lib/email/router');

      await sendSmartEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>test</p>',
      });

      const usage = getEmailUsage();
      expect(usage.resend).toBeDefined();
      expect(usage.brevo).toBeDefined();
      expect(usage.sendgrid).toBeDefined();
      expect(usage.resend.sentToday).toBe(1);
      expect(usage.resend.sentThisMonth).toBe(1);
      expect(usage.resend.dailyLimit).toBe(100);
      expect(usage.resend.monthlyLimit).toBe(3000);
    });
  });

  describe('resetDailyCounters', () => {
    it('resets sentToday for all providers', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_001' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail, resetDailyCounters, getEmailUsage } = await import('@/lib/email/router');

      await sendSmartEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>test</p>',
      });

      resetDailyCounters();

      const usage = getEmailUsage();
      expect(usage.resend.sentToday).toBe(0);
      expect(usage.resend.sentThisMonth).toBe(1); // monthly unchanged
    });
  });

  describe('resetMonthlyCounters', () => {
    it('resets sentThisMonth for all providers', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_001' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail, resetMonthlyCounters, getEmailUsage } = await import('@/lib/email/router');

      await sendSmartEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>test</p>',
      });

      resetMonthlyCounters();

      const usage = getEmailUsage();
      expect(usage.resend.sentThisMonth).toBe(0);
      expect(usage.resend.sentToday).toBe(1); // daily unchanged
    });
  });

  describe('provider health tracking', () => {
    it('marks provider unhealthy on failure', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;
      process.env.SENDGRID_API_KEY = API_KEYS.SENDGRID_API_KEY;

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'sg_001' }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail, getEmailUsage } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'user@example.com',
        type: 'critical',
        subject: 'Health test',
        html: '<p>health</p>',
      });

      expect(result.provider).toBe('SendGrid');

      const usage = getEmailUsage();
      expect(usage.resend.healthy).toBe(false);
      expect(usage.resend.lastError).toBe('Resend error: Service unavailable');
    });
  });

  describe('default from address', () => {
    it('uses onboarding@resend.dev as default from for Resend', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_default_from' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      await sendSmartEmail({
        to: 'user@example.com',
        subject: 'Default from',
        html: '<p>test</p>',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.from).toBe('NuCRM <onboarding@resend.dev>');
    });

    it('uses custom from address when provided', async () => {
      process.env.RESEND_API_KEY = API_KEYS.RESEND_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_custom_from' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { sendSmartEmail } = await import('@/lib/email/router');

      await sendSmartEmail({
        to: 'user@example.com',
        from: 'Custom <custom@example.com>',
        subject: 'Custom from',
        html: '<p>test</p>',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.from).toBe('Custom <custom@example.com>');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dayKey = `email-usage:resend:${new Date().toISOString().slice(0, 10)}`;

describe('email router — persisted provider limits', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RESEND_API_KEY = 're_test';
    process.env.SENDGRID_API_KEY = 'SG_test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({}),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
  });

  it('skips a provider whose daily quota was consumed by another instance', async () => {
    const cache = await import('@/lib/cache');
    await cache.set(dayKey, 100, 60);
    try {
      const { sendSmartEmail } = await import('@/lib/email/router');

      const result = await sendSmartEmail({
        to: 'visitor@example.com',
        subject: 'Quota check',
        html: '<p>check</p>',
      });

      expect(result.provider).toBe('SendGrid');
    } finally {
      await cache.del(dayKey);
    }
  });
});

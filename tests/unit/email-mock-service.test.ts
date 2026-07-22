import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer from 'nodemailer';

const { mockSendMail } = vi.hoisted(() => {
  const mockSendMail = vi.fn().mockResolvedValue({ accepted: ['test@example.com'] });
  return { mockSendMail };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

describe('email/mock-service', () => {
  let mod: typeof import('@/lib/email/mock-service');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_TEST_MODE;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_FROM_NAME;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('test mode (RESEND_TEST_MODE=true)', () => {
    beforeEach(async () => {
      process.env.RESEND_TEST_MODE = 'true';
      mod = await import('@/lib/email/mock-service');
    });

    it('send() logs to console and returns true', async () => {
      const result = await mod.emailService.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });
      expect(result).toBe(true);
      expect(console.log).toHaveBeenCalled();
    });

    it('send() handles array recipients', async () => {
      const result = await mod.emailService.send({
        to: ['a@example.com', 'b@example.com'],
        subject: 'Test',
        html: '<p>Hello</p>',
      });
      expect(result).toBe(true);
    });

    it('sendVerificationEmail() calls send() with correct args', async () => {
      const sendSpy = vi.spyOn(mod.emailService, 'send');
      await mod.emailService.sendVerificationEmail('user@example.com', 'tok123');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Verify Your Email - NuCRM',
        }),
      );
    });

    it('sendPasswordReset() calls send() with correct args', async () => {
      const sendSpy = vi.spyOn(mod.emailService, 'send');
      await mod.emailService.sendPasswordReset('user@example.com', 'tok456');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Reset Your Password - NuCRM',
        }),
      );
    });

    it('sendWelcomeEmail() calls send() with correct args', async () => {
      const sendSpy = vi.spyOn(mod.emailService, 'send');
      await mod.emailService.sendWelcomeEmail('user@example.com', 'Alice');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Welcome'),
        }),
      );
    });
  });

  describe('test mode (no RESEND_API_KEY)', () => {
    beforeEach(async () => {
      delete process.env.RESEND_API_KEY;
      mod = await import('@/lib/email/mock-service');
    });

    it('enters test mode when API key is missing', async () => {
      const result = await mod.emailService.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });
      expect(result).toBe(true);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('live mode (RESEND_API_KEY set, no test mode)', () => {
    beforeEach(async () => {
      process.env.RESEND_API_KEY = 're_abc123';
      delete process.env.RESEND_TEST_MODE;
      mod = await import('@/lib/email/mock-service');
    });

    it('send() uses nodemailer transport and returns true on success', async () => {
      const result = await mod.emailService.send({
        to: 'user@example.com',
        subject: 'Live Test',
        html: '<p>Content</p>',
      });
      expect(result).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('sent successfully'), 'user@example.com');
    });

    it('send() returns false and logs error when transport fails', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP error'));

      const result = await mod.emailService.send({
        to: 'user@example.com',
        subject: 'Fail',
        html: '<p>Fail</p>',
      });
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send email'),
        expect.any(Error),
      );
    });

    it('send() respects SMTP_HOST and SMTP_PORT env vars', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '2525';
      vi.resetModules();
      vi.clearAllMocks();
      mod = await import('@/lib/email/mock-service');

      await mod.emailService.send({
        to: 'user@example.com',
        subject: 'Custom',
        html: '<p>Custom</p>',
      });

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 2525,
        }),
      );
    });
  });

  describe('createEmailService()', () => {
    it('returns a MockEmailService instance', async () => {
      const { createEmailService } = await import('@/lib/email/mock-service');
      const svc = createEmailService();
      expect(svc).toBeDefined();
      expect(typeof svc.send).toBe('function');
      expect(typeof svc.sendVerificationEmail).toBe('function');
      expect(typeof svc.sendPasswordReset).toBe('function');
      expect(typeof svc.sendWelcomeEmail).toBe('function');
    });
  });

  describe('singleton', () => {
    it('emailService is a singleton instance', async () => {
      mod = await import('@/lib/email/mock-service');
      const mod2 = await import('@/lib/email/mock-service');
      expect(mod.emailService).toBe(mod2.emailService);
    });

    it('default export is the same singleton', async () => {
      mod = await import('@/lib/email/mock-service');
      expect(mod.default).toBe(mod.emailService);
    });
  });

  describe('console.log output in test mode', () => {
    beforeEach(async () => {
      process.env.RESEND_TEST_MODE = 'true';
      mod = await import('@/lib/email/mock-service');
    });

    it('logs recipient, subject and body preview', async () => {
      await mod.emailService.send({
        to: 'dev@example.com',
        subject: 'Debug',
        html: '<p>Short body</p>',
      });

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c: string[]) => c[0].includes('Would send to'))).toBe(true);
      expect(calls.some((c: string[]) => c[0].includes('Subject:'))).toBe(true);
      expect(calls.some((c: string[]) => c[0].includes('Body preview'))).toBe(true);
    });
  });
});

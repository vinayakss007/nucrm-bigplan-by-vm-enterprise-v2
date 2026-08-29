/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// nodemailer sendMail mock shared across the SMTP tests
const { mockSendMail } = vi.hoisted(() => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'smtp_msg_1' });
  return { mockSendMail };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

const PDF_BUFFER = Buffer.from('%PDF-1.4 test');
const PDF_BASE64 = PDF_BUFFER.toString('base64');
const ATTACHMENT = {
  filename: 'r.pdf',
  content: PDF_BUFFER,
  contentType: 'application/pdf',
};

describe('email attachments — lib/email/service.ts (sendEmail)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Resend body carries attachments with base64 content and content_type', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_1' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { sendEmail } = await import('@/lib/email/service');
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'With attachment',
      html: '<p>hi</p>',
      attachments: [ATTACHMENT],
    });

    expect(result.success).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe('r.pdf');
    expect(body.attachments[0].content).toBe(PDF_BASE64);
    expect(body.attachments[0].content_type).toBe('application/pdf');
  });

  it('Resend body has NO attachments key when none passed (no regression)', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_2' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { sendEmail } = await import('@/lib/email/service');
    await sendEmail({
      to: 'user@example.com',
      subject: 'No attachment',
      html: '<p>hi</p>',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect('attachments' in body).toBe(false);
  });

  it('SMTP/nodemailer receives the Buffer content and contentType directly', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';

    const { sendEmail } = await import('@/lib/email/service');
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'SMTP attachment',
      html: '<p>hi</p>',
      attachments: [ATTACHMENT],
    });

    expect(result.success).toBe(true);
    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.attachments).toHaveLength(1);
    expect(mailArg.attachments[0].filename).toBe('r.pdf');
    expect(Buffer.isBuffer(mailArg.attachments[0].content)).toBe(true);
    expect(mailArg.attachments[0].content.equals(PDF_BUFFER)).toBe(true);
    expect(mailArg.attachments[0].contentType).toBe('application/pdf');
  });

  it('SMTP/nodemailer has NO attachments key when none passed (no regression)', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';

    const { sendEmail } = await import('@/lib/email/service');
    await sendEmail({
      to: 'user@example.com',
      subject: 'SMTP no attachment',
      html: '<p>hi</p>',
    });

    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.attachments).toBeUndefined();
  });
});

describe('email attachments — lib/email/router.ts (sendSmartEmail)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.RESEND_API_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDGRID_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Resend: attachments serialized as base64 content + content_type', async () => {
    process.env.RESEND_API_KEY = 're_router_1';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }) });
    vi.stubGlobal('fetch', mockFetch);

    const { sendSmartEmail } = await import('@/lib/email/router');
    await sendSmartEmail({
      to: 'user@example.com',
      subject: 'Resend router',
      html: '<p>hi</p>',
      attachments: [ATTACHMENT],
    });

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe('r.pdf');
    expect(body.attachments[0].content).toBe(PDF_BASE64);
    expect(body.attachments[0].content_type).toBe('application/pdf');
  });

  it('Brevo: uses `attachment` with `name` + base64 `content`', async () => {
    process.env.BREVO_API_KEY = 'brevo_1';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: 'b1' }) });
    vi.stubGlobal('fetch', mockFetch);

    const { sendSmartEmail } = await import('@/lib/email/router');
    await sendSmartEmail({
      to: 'user@example.com',
      subject: 'Brevo router',
      html: '<p>hi</p>',
      attachments: [ATTACHMENT],
    });

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachment).toHaveLength(1);
    expect(body.attachment[0].name).toBe('r.pdf');
    expect(body.attachment[0].content).toBe(PDF_BASE64);
    // Brevo shape uses name/content only
    expect('filename' in body.attachment[0]).toBe(false);
  });

  it('SendGrid: attachments with base64 `content` + `type` + `disposition`', async () => {
    process.env.SENDGRID_API_KEY = 'SG.sg_1';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    const { sendSmartEmail } = await import('@/lib/email/router');
    await sendSmartEmail({
      to: 'user@example.com',
      subject: 'SendGrid router',
      html: '<p>hi</p>',
      attachments: [ATTACHMENT],
    });

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.sendgrid.com/v3/mail/send');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe('r.pdf');
    expect(body.attachments[0].content).toBe(PDF_BASE64);
    expect(body.attachments[0].type).toBe('application/pdf');
    expect(body.attachments[0].disposition).toBe('attachment');
  });

  it('Resend: NO attachments key when none passed (no regression)', async () => {
    process.env.RESEND_API_KEY = 're_router_2';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r2' }) });
    vi.stubGlobal('fetch', mockFetch);

    const { sendSmartEmail } = await import('@/lib/email/router');
    await sendSmartEmail({ to: 'user@example.com', subject: 'no att', html: '<p>hi</p>' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect('attachments' in body).toBe(false);
  });

  it('Brevo: NO attachment key when none passed (no regression)', async () => {
    process.env.BREVO_API_KEY = 'brevo_2';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: 'b2' }) });
    vi.stubGlobal('fetch', mockFetch);

    const { sendSmartEmail } = await import('@/lib/email/router');
    await sendSmartEmail({ to: 'user@example.com', subject: 'no att', html: '<p>hi</p>' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect('attachment' in body).toBe(false);
  });

  it('SendGrid: NO attachments key when none passed (no regression)', async () => {
    process.env.SENDGRID_API_KEY = 'SG.sg_2';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    const { sendSmartEmail } = await import('@/lib/email/router');
    await sendSmartEmail({ to: 'user@example.com', subject: 'no att', html: '<p>hi</p>' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect('attachments' in body).toBe(false);
  });
});

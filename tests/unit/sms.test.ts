import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    query: {
      smsTemplates: { findFirst: vi.fn() },
      smsMessages: { findFirst: vi.fn() },
      contacts: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/drizzle/schema/sms', () => ({
  smsMessages: { id: 'id', tenantId: 'tenant_id', status: 'status', twilioSid: 'twilio_sid', body: 'body' },
  smsTemplates: { id: 'id', tenantId: 'tenant_id' },
}));

vi.mock('@/drizzle/schema', () => ({
  contacts: { phone: 'phone', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  desc: vi.fn((col: any) => col),
  sql: vi.fn(),
}));

import { db } from '@/drizzle/db';

const TWILIO_CONFIG = {
  TWILIO_ACCOUNT_SID: 'AC-test-account',
  TWILIO_AUTH_TOKEN: 'test-auth-token-12345',
  TWILIO_FROM_NUMBER: '+15551234567',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['TWILIO_ACCOUNT_SID'] = TWILIO_CONFIG.TWILIO_ACCOUNT_SID;
  process.env['TWILIO_AUTH_TOKEN'] = TWILIO_CONFIG.TWILIO_AUTH_TOKEN;
  process.env['TWILIO_FROM_NUMBER'] = TWILIO_CONFIG.TWILIO_FROM_NUMBER;
});

describe('SMS - Template Interpolation', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let interpolateTemplate: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extractTemplateVariables: any;

  beforeEach(async () => {
    const mod = await import('@/lib/sms');
    interpolateTemplate = mod.interpolateTemplate;
    extractTemplateVariables = mod.extractTemplateVariables;
  });

  describe('interpolateTemplate', () => {
    it('replaces simple variables in a template', () => {
      const template = 'Hello {{contact.name}}, your deal is worth {{deal.value}}!';
      const variables = { 'contact.name': 'Alice', 'deal.value': '$5000' };
      expect(interpolateTemplate(template, variables)).toBe('Hello Alice, your deal is worth $5000!');
    });

    it('leaves unmatched variables as-is', () => {
      const template = 'Hi {{contact.name}}, your {{unknown.field}} is ready.';
      const variables = { 'contact.name': 'Bob' };
      expect(interpolateTemplate(template, variables)).toBe('Hi Bob, your {{unknown.field}} is ready.');
    });

    it('handles templates with no variables', () => {
      const template = 'This is a plain message.';
      expect(interpolateTemplate(template, {})).toBe('This is a plain message.');
    });

    it('handles multiple occurrences of the same variable', () => {
      const template = '{{name}} said hello. Yes, {{name}} did.';
      expect(interpolateTemplate(template, { name: 'Charlie' })).toBe('Charlie said hello. Yes, Charlie did.');
    });

    it('handles nested-style dot notation variables', () => {
      const template = 'Company: {{company.name}}, Contact: {{contact.firstName}} {{contact.lastName}}';
      const variables = { 'company.name': 'Acme Corp', 'contact.firstName': 'Jane', 'contact.lastName': 'Doe' };
      expect(interpolateTemplate(template, variables)).toBe('Company: Acme Corp, Contact: Jane Doe');
    });

    it('handles empty string variables', () => {
      expect(interpolateTemplate('Hello {{name}}, welcome!', { name: '' })).toBe('Hello , welcome!');
    });
  });

  describe('extractTemplateVariables', () => {
    it('extracts all variable names from a template', () => {
      const vars = extractTemplateVariables('Hello {{contact.name}}, deal: {{deal.value}}, rep: {{agent.name}}');
      expect(vars).toContain('contact.name');
      expect(vars).toContain('deal.value');
      expect(vars).toContain('agent.name');
      expect(vars).toHaveLength(3);
    });

    it('returns unique variables only', () => {
      expect(extractTemplateVariables('{{name}} and {{name}} again')).toEqual(['name']);
    });

    it('returns empty array for templates without variables', () => {
      expect(extractTemplateVariables('Plain text, no variables here.')).toEqual([]);
    });
  });
});

describe('SMS - Twilio Signature Validation', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validateTwilioSignature: any;

  beforeEach(async () => {
    const mod = await import('@/lib/sms');
    validateTwilioSignature = mod.validateTwilioSignature;
  });

  it('returns false when auth token is empty', () => {
    process.env['TWILIO_AUTH_TOKEN'] = '';
    expect(validateTwilioSignature('sig', 'https://example.com', {})).toBe(false);
  });

  it('validates correct signature', () => {
    const url = 'https://example.com/webhook';
    const params = { Body: 'Hello', From: '+1234567890' };
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      data += key + (params as any)[key];
    }
    const expected = crypto.createHmac('sha1', TWILIO_CONFIG.TWILIO_AUTH_TOKEN).update(data).digest('base64');
    expect(validateTwilioSignature(expected, url, params)).toBe(true);
  });

  it('rejects invalid signature', () => {
    expect(validateTwilioSignature('invalid-sig', 'https://example.com/webhook', { Body: 'Hi' })).toBe(false);
  });

  it('handles empty params object', () => {
    const url = 'https://example.com/webhook';
    const expected = crypto.createHmac('sha1', TWILIO_CONFIG.TWILIO_AUTH_TOKEN).update(url).digest('base64');
    expect(validateTwilioSignature(expected, url, {})).toBe(true);
  });
});

describe('SMS - sendSMS', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendSMS: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env['TWILIO_ACCOUNT_SID'] = TWILIO_CONFIG.TWILIO_ACCOUNT_SID;
    process.env['TWILIO_AUTH_TOKEN'] = TWILIO_CONFIG.TWILIO_AUTH_TOKEN;
    process.env['TWILIO_FROM_NUMBER'] = TWILIO_CONFIG.TWILIO_FROM_NUMBER;
    const mod = await import('@/lib/sms');
    sendSMS = mod.sendSMS;
  });

  it('sends SMS via Twilio and records in DB', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ sid: 'SM-twilio-sid-123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendSMS({
      to: '+15559876543',
      body: 'Hello from NuCRM!',
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(result.twilioSid).toBe('SM-twilio-sid-123');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.twilio.com'),
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('overrides from number when provided', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-2' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ sid: 'SM-sid' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendSMS({
      to: '+15559876543',
      body: 'Hello',
      tenantId: 'tenant-1',
      from: '+15551112222',
    });

    const fetchBody = mockFetch.mock.calls[0][1].body;
    expect(fetchBody.toString()).toContain('From=%2B15551112222');

    vi.unstubAllGlobals();
  });

  it('marks message as failed when Twilio returns error', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-3' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ code: 21211, message: 'Invalid number' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

    const result = await sendSMS({
      to: 'invalid',
      body: 'Hello',
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: '21211' }),
    );

    vi.unstubAllGlobals();
  });

  it('handles network errors gracefully', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-4' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

    const result = await sendSMS({
      to: '+15559876543',
      body: 'Hello',
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'NETWORK_ERROR' }),
    );

    vi.unstubAllGlobals();
  });

  it('accepts optional contactId', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn((_vals: any) => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-5' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ sid: 'SM-sid' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendSMS({
      to: '+15559876543',
      body: 'Hello',
      tenantId: 'tenant-1',
      contactId: 'contact-99',
    });

    expect(db.insert).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('SMS - sendTemplateSMS', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendTemplateSMS: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env['TWILIO_ACCOUNT_SID'] = TWILIO_CONFIG.TWILIO_ACCOUNT_SID;
    process.env['TWILIO_AUTH_TOKEN'] = TWILIO_CONFIG.TWILIO_AUTH_TOKEN;
    process.env['TWILIO_FROM_NUMBER'] = TWILIO_CONFIG.TWILIO_FROM_NUMBER;
    const mod = await import('@/lib/sms');
    sendTemplateSMS = mod.sendTemplateSMS;
  });

  it('sends template SMS with interpolated variables', async () => {
    vi.mocked(db.query.smsTemplates.findFirst).mockResolvedValue({
      id: 'tmpl-1',
      body: 'Hi {{contact.name}}, your invoice of {{amount}} is due.',
      tenantId: 'tenant-1',
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-t1' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ sid: 'SM-tmpl-sid' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendTemplateSMS({
      to: '+15559876543',
      templateId: 'tmpl-1',
      variables: { 'contact.name': 'Alice', 'amount': '$500' },
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(true);
    expect(result.interpolatedBody).toBe('Hi Alice, your invoice of $500 is due.');

    vi.unstubAllGlobals();
  });

  it('returns error when template not found', async () => {
    vi.mocked(db.query.smsTemplates.findFirst).mockResolvedValue(null);

    const result = await sendTemplateSMS({
      to: '+15559876543',
      templateId: 'non-existent',
      variables: {},
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Template not found');
  });

  it('handles Twilio error for template SMS', async () => {
    vi.mocked(db.query.smsTemplates.findFirst).mockResolvedValue({
      id: 'tmpl-2',
      body: 'Hello {{name}}!',
      tenantId: 'tenant-1',
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-t2' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ code: 21610, message: 'Not allowed' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendTemplateSMS({
      to: '+15559876543',
      templateId: 'tmpl-2',
      variables: { name: 'Bob' },
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);

    vi.unstubAllGlobals();
  });

  it('handles network error for template SMS', async () => {
    vi.mocked(db.query.smsTemplates.findFirst).mockResolvedValue({
      id: 'tmpl-3',
      body: 'Test {{key}}',
      tenantId: 'tenant-1',
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-t3' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));

    const result = await sendTemplateSMS({
      to: '+15559876543',
      templateId: 'tmpl-3',
      variables: { key: 'value' },
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');

    vi.unstubAllGlobals();
  });
});

describe('SMS - handleIncomingSMS', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handleIncomingSMS: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env['TWILIO_ACCOUNT_SID'] = TWILIO_CONFIG.TWILIO_ACCOUNT_SID;
    process.env['TWILIO_AUTH_TOKEN'] = TWILIO_CONFIG.TWILIO_AUTH_TOKEN;
    process.env['TWILIO_FROM_NUMBER'] = TWILIO_CONFIG.TWILIO_FROM_NUMBER;
    const mod = await import('@/lib/sms');
    handleIncomingSMS = mod.handleIncomingSMS;
  });

  it('creates inbound message record and links to existing contact', async () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.query.contacts.findFirst).mockResolvedValue({ id: 'contact-5' } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-in-1' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await handleIncomingSMS({
      From: '+15551234567',
      To: '+15559876543',
      Body: 'Hello, I have a question',
      MessageSid: 'SM-incoming-1',
    }, 'tenant-1');

    expect(result.messageId).toBe('msg-in-1');
    expect(result.contactId).toBe('contact-5');
  });

  it('creates inbound message with null contactId when no match', async () => {
    vi.mocked(db.query.contacts.findFirst).mockResolvedValue(null);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-in-2' }]),
      })),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await handleIncomingSMS({
      From: '+15559999999',
      To: '+15559876543',
      Body: 'Who dis?',
      MessageSid: 'SM-incoming-2',
    }, 'tenant-1');

    expect(result.contactId).toBeNull();
  });
});

describe('SMS - updateDeliveryStatus', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let updateDeliveryStatus: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/lib/sms');
    updateDeliveryStatus = mod.updateDeliveryStatus;
  });

  it('updates status to delivered', async () => {
    const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

    const result = await updateDeliveryStatus({
      MessageSid: 'SM-123',
      MessageStatus: 'delivered',
    });

    expect(result.status).toBe('delivered');
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered' }));
  });

  it('maps undelivered to failed', async () => {
    const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

    const result = await updateDeliveryStatus({
      MessageSid: 'SM-456',
      MessageStatus: 'undelivered',
      ErrorCode: '30007',
    });

    expect(result.status).toBe('failed');
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: '30007' }),
    );
  });

  it('maps queued and sent statuses', async () => {
    const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

    const result = await updateDeliveryStatus({
      MessageSid: 'SM-789',
      MessageStatus: 'queued',
    });
    expect(result.status).toBe('queued');

    const result2 = await updateDeliveryStatus({
      MessageSid: 'SM-012',
      MessageStatus: 'sent',
    });
    expect(result2.status).toBe('sent');
  });

  it('passes through unknown statuses', async () => {
    const setFn = vi.fn(() => ({ where: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

    const result = await updateDeliveryStatus({
      MessageSid: 'SM-999',
      MessageStatus: 'unknown_status',
    });

    expect(result.status).toBe('unknown_status');
  });
});

describe('SMS - getDeliveryStatus', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getDeliveryStatus: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/lib/sms');
    getDeliveryStatus = mod.getDeliveryStatus;
  });

  it('returns message status when found', async () => {
    vi.mocked(db.query.smsMessages.findFirst).mockResolvedValue({
      id: 'msg-1',
      status: 'delivered',
      twilioSid: 'SM-sid',
      errorCode: null,
      createdAt: new Date(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await getDeliveryStatus('msg-1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('delivered');
  });

  it('returns null when message not found', async () => {
    vi.mocked(db.query.smsMessages.findFirst).mockResolvedValue(null);

    const result = await getDeliveryStatus('non-existent');
    expect(result).toBeNull();
  });
});

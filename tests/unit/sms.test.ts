import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interpolateTemplate, extractTemplateVariables, validateTwilioSignature } from '@/lib/sms';

// Mock DB and schema
vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]) }) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    query: {
      smsTemplates: { findFirst: vi.fn().mockResolvedValue(null) },
      smsMessages: { findFirst: vi.fn().mockResolvedValue(null) },
      contacts: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  },
}));

vi.mock('@/drizzle/schema/sms', () => ({
  smsMessages: { id: 'id', tenantId: 'tenant_id', status: 'status', twilioSid: 'twilio_sid' },
  smsTemplates: { id: 'id', tenantId: 'tenant_id' },
}));

vi.mock('@/drizzle/schema', () => ({
  contacts: { phone: 'phone', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  sql: vi.fn(),
}));

describe('SMS - Template Interpolation', () => {
  it('replaces simple variables in a template', () => {
    const template = 'Hello {{contact.name}}, your deal is worth {{deal.value}}!';
    const variables = { 'contact.name': 'Alice', 'deal.value': '$5000' };

    const result = interpolateTemplate(template, variables);

    expect(result).toBe('Hello Alice, your deal is worth $5000!');
  });

  it('leaves unmatched variables as-is', () => {
    const template = 'Hi {{contact.name}}, your {{unknown.field}} is ready.';
    const variables = { 'contact.name': 'Bob' };

    const result = interpolateTemplate(template, variables);

    expect(result).toBe('Hi Bob, your {{unknown.field}} is ready.');
  });

  it('handles templates with no variables', () => {
    const template = 'This is a plain message with no variables.';
    const variables = {};

    const result = interpolateTemplate(template, variables);

    expect(result).toBe('This is a plain message with no variables.');
  });

  it('handles multiple occurrences of the same variable', () => {
    const template = '{{name}} said hello. Yes, {{name}} did.';
    const variables = { name: 'Charlie' };

    const result = interpolateTemplate(template, variables);

    expect(result).toBe('Charlie said hello. Yes, Charlie did.');
  });

  it('handles nested-style dot notation variables', () => {
    const template = 'Company: {{company.name}}, Contact: {{contact.firstName}} {{contact.lastName}}';
    const variables = {
      'company.name': 'Acme Corp',
      'contact.firstName': 'Jane',
      'contact.lastName': 'Doe',
    };

    const result = interpolateTemplate(template, variables);

    expect(result).toBe('Company: Acme Corp, Contact: Jane Doe');
  });

  it('handles empty string variables', () => {
    const template = 'Hello {{name}}, welcome!';
    const variables = { name: '' };

    const result = interpolateTemplate(template, variables);

    expect(result).toBe('Hello , welcome!');
  });
});

describe('SMS - extractTemplateVariables', () => {
  it('extracts all variable names from a template', () => {
    const template = 'Hello {{contact.name}}, deal: {{deal.value}}, rep: {{agent.name}}';

    const vars = extractTemplateVariables(template);

    expect(vars).toContain('contact.name');
    expect(vars).toContain('deal.value');
    expect(vars).toContain('agent.name');
    expect(vars).toHaveLength(3);
  });

  it('returns unique variables only', () => {
    const template = '{{name}} and {{name}} again';

    const vars = extractTemplateVariables(template);

    expect(vars).toEqual(['name']);
  });

  it('returns empty array for templates without variables', () => {
    const template = 'Plain text, no variables here.';

    const vars = extractTemplateVariables(template);

    expect(vars).toEqual([]);
  });
});

describe('SMS - Twilio Signature Validation', () => {
  beforeEach(() => {
    process.env['TWILIO_AUTH_TOKEN'] = 'test-auth-token-12345';
  });

  it('returns false when auth token is empty', () => {
    process.env['TWILIO_AUTH_TOKEN'] = '';
    const result = validateTwilioSignature('sig', 'https://example.com', {});
    expect(result).toBe(false);
  });

  it('validates correct signature', () => {
    // Generate a valid signature manually
    const crypto = require('crypto');
    const url = 'https://example.com/webhook';
    const params = { Body: 'Hello', From: '+1234567890' };
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + (params as any)[key];
    }
    const expected = crypto.createHmac('sha1', 'test-auth-token-12345').update(data).digest('base64');

    const result = validateTwilioSignature(expected, url, params);

    expect(result).toBe(true);
  });

  it('rejects invalid signature', () => {
    const result = validateTwilioSignature('invalid-sig', 'https://example.com/webhook', { Body: 'Hi' });
    expect(result).toBe(false);
  });
});

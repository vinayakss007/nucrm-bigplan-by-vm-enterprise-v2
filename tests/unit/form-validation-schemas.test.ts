import { describe, it, expect } from 'vitest';
import {
  simpleLeadFormSchema,
  leadCaptureFormSchema,
  smsComposeSchema,
  meetingFormSchema,
  webhookFormSchema,
  brandingFormSchema,
  backupConfigSchema,
  createUserSchema,
  buildPublicFormSchema,
  validateForm,
} from '@/lib/validation/forms';

// Helper: collect field-error keys from a flattened safeParse failure.
function fieldErrorKeys(schema: Parameters<typeof validateForm>[0], values: unknown): string[] {
  const res = validateForm(schema, values);
  if (res.success) return [];
  return Object.keys(res.errors);
}

describe('simpleLeadFormSchema', () => {
  it('accepts a fully-valid object', () => {
    const r = simpleLeadFormSchema.safeParse({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      phone: '+1 (555) 123-4567',
      company: 'Analytical Engines',
      message: 'Hello',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(fieldErrorKeys(simpleLeadFormSchema, {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'not-an-email',
    })).toContain('email');
  });

  it('rejects a missing required first name', () => {
    expect(fieldErrorKeys(simpleLeadFormSchema, {
      first_name: '',
      last_name: 'Lovelace',
      email: 'ada@example.com',
    })).toContain('first_name');
  });
});

describe('leadCaptureFormSchema', () => {
  it('accepts a fully-valid object', () => {
    const r = leadCaptureFormSchema.safeParse({
      first_name: 'Grace',
      last_name: 'Hopper',
      email: 'grace@example.com',
      phone: '5551234567',
      company: 'Navy',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a missing required last name', () => {
    expect(fieldErrorKeys(leadCaptureFormSchema, {
      first_name: 'Grace',
      last_name: '',
      email: 'grace@example.com',
    })).toContain('last_name');
  });

  it('rejects an invalid email', () => {
    expect(fieldErrorKeys(leadCaptureFormSchema, {
      first_name: 'Grace',
      last_name: 'Hopper',
      email: 'bad',
    })).toContain('email');
  });
});

describe('smsComposeSchema', () => {
  it('accepts a valid message with body', () => {
    const r = smsComposeSchema.safeParse({ to: '+1 (555) 123-4567', body: 'Hi there' });
    expect(r.success).toBe(true);
  });

  it('accepts a valid message with a templateId and no body', () => {
    const r = smsComposeSchema.safeParse({ to: '5551234567', templateId: 'tpl-1' });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid phone number', () => {
    expect(fieldErrorKeys(smsComposeSchema, { to: '123', body: 'Hi' })).toContain('to');
  });

  it('rejects when neither body nor templateId is present', () => {
    const res = validateForm(smsComposeSchema, { to: '5551234567' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(Object.keys(res.errors)).toContain('body');
    }
  });
});

describe('meetingFormSchema', () => {
  it('accepts a valid meeting', () => {
    const r = meetingFormSchema.safeParse({
      title: 'Sync',
      start_time: '2026-01-01T10:00',
      end_time: '2026-01-01T11:00',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a missing title', () => {
    expect(fieldErrorKeys(meetingFormSchema, {
      title: '',
      start_time: '2026-01-01T10:00',
    })).toContain('title');
  });

  it('rejects when end time is before start time', () => {
    expect(fieldErrorKeys(meetingFormSchema, {
      title: 'Sync',
      start_time: '2026-01-01T11:00',
      end_time: '2026-01-01T10:00',
    })).toContain('end_time');
  });
});

describe('webhookFormSchema', () => {
  it('accepts a valid webhook', () => {
    const r = webhookFormSchema.safeParse({
      name: 'My hook',
      url: 'https://example.com/hook',
      events: ['lead.created'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-url', () => {
    expect(fieldErrorKeys(webhookFormSchema, {
      name: 'My hook',
      url: 'not a url',
      events: ['lead.created'],
    })).toContain('url');
  });

  it('rejects an empty events array', () => {
    expect(fieldErrorKeys(webhookFormSchema, {
      name: 'My hook',
      url: 'https://example.com/hook',
      events: [],
    })).toContain('events');
  });
});

describe('brandingFormSchema', () => {
  const valid = {
    logoUrl: '',
    faviconUrl: '',
    primaryColor: '#7c3aed',
    secondaryColor: '#123456',
    accentColor: '#abcdef',
    companyName: 'Acme',
    customDomain: 'crm.acme.com',
    customCss: '',
    headerLayout: 'default' as const,
  };

  it('accepts a valid branding config', () => {
    expect(brandingFormSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a bad hex color', () => {
    expect(fieldErrorKeys(brandingFormSchema, { ...valid, primaryColor: 'purple' })).toContain('primaryColor');
  });

  it('accepts a 3-digit hex color', () => {
    expect(brandingFormSchema.safeParse({ ...valid, primaryColor: '#fff' }).success).toBe(true);
  });

  it('rejects an invalid logo url', () => {
    expect(fieldErrorKeys(brandingFormSchema, { ...valid, logoUrl: 'not a url' })).toContain('logoUrl');
  });

  it('rejects a custom domain with a protocol', () => {
    expect(fieldErrorKeys(brandingFormSchema, { ...valid, customDomain: 'https://crm.acme.com' })).toContain('customDomain');
  });
});

describe('backupConfigSchema', () => {
  const valid = {
    bucket: 'my-bucket',
    endpoint_url: 'https://s3.example.com',
    access_key: 'AKIA',
    secret_key: 'secret',
    region: 'us-east-1',
    retention_days: 30,
  };

  it('accepts a valid backup config', () => {
    expect(backupConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing bucket', () => {
    expect(fieldErrorKeys(backupConfigSchema, { ...valid, bucket: '' })).toContain('bucket');
  });

  it('rejects out-of-range retention_days', () => {
    expect(fieldErrorKeys(backupConfigSchema, { ...valid, retention_days: 400 })).toContain('retention_days');
  });

  it('rejects an invalid endpoint url', () => {
    expect(fieldErrorKeys(backupConfigSchema, { ...valid, endpoint_url: 'nope' })).toContain('endpoint_url');
  });
});

describe('createUserSchema', () => {
  it('accepts a valid user', () => {
    const r = createUserSchema.safeParse({
      email: 'admin@example.com',
      full_name: 'Admin User',
      password: 'StrongPass1!x',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(fieldErrorKeys(createUserSchema, {
      email: 'bad',
      password: 'StrongPass1!x',
    })).toContain('email');
  });

  it('rejects a weak password', () => {
    expect(fieldErrorKeys(createUserSchema, {
      email: 'admin@example.com',
      password: 'short',
    })).toContain('password');
  });
});

describe('buildPublicFormSchema', () => {
  it('accepts values where required fields are present', () => {
    const schema = buildPublicFormSchema([
      { key: 'name', label: 'Name', required: true },
      { key: 'note', required: false },
    ]);
    expect(schema.safeParse({ name: 'Ada', note: '' }).success).toBe(true);
  });

  it('rejects when a required field is empty', () => {
    const schema = buildPublicFormSchema([{ key: 'name', label: 'Name', required: true }]);
    expect(fieldErrorKeys(schema, { name: '' })).toContain('name');
  });
});

describe('validateForm helper', () => {
  it('returns success:false with a mapped errors record for invalid input', () => {
    const res = validateForm(simpleLeadFormSchema, {
      first_name: '',
      last_name: 'Lovelace',
      email: 'bad',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(typeof res.errors).toBe('object');
      expect(res.errors.first_name).toBeTruthy();
      expect(res.errors.email).toBeTruthy();
      // each value is a single string message
      expect(typeof res.errors.email).toBe('string');
    }
  });

  it('returns success:true with typed data for valid input', () => {
    const res = validateForm(leadCaptureFormSchema, {
      first_name: 'Grace',
      last_name: 'Hopper',
      email: 'grace@example.com',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe('grace@example.com');
    }
  });

  it('surfaces cross-field refinement messages under _form when path is empty', () => {
    // A refinement without a path lands in formErrors -> _form key.
    const schema = simpleLeadFormSchema.refine(
      (v) => v.first_name !== v.last_name,
      { message: 'First and last name must differ' }
    );
    const res = validateForm(schema, {
      first_name: 'Same',
      last_name: 'Same',
      email: 'same@example.com',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors._form).toBe('First and last name must differ');
    }
  });
});

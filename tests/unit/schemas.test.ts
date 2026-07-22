 
import { describe, it, expect } from 'vitest';

const schemas = await import('@/lib/api/schemas');

const UUID = '550e8400-e29b-41d4-a716-446655440000';
// ─── Auth schemas ──────────────────────────────────────────────
describe('signupSchema', () => {
  it('accepts valid signup data', () => {
    const result = schemas.signupSchema.safeParse({
      email: 'Test@Example.COM',
      password: 'password123',
      full_name: 'John Doe',
      workspace_name: 'My Workspace',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com'); // lowercased + trimmed
    }
  });

  it('rejects invalid email', () => {
    const result = schemas.signupSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
      full_name: 'John',
      workspace_name: 'Work',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = schemas.signupSchema.safeParse({
      email: 'a@b.com',
      password: 'short',
      full_name: 'John',
      workspace_name: 'Work',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing full_name', () => {
    const result = schemas.signupSchema.safeParse({
      email: 'a@b.com',
      password: 'password123',
      full_name: '',
      workspace_name: 'Work',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid login', () => {
    const result = schemas.loginSchema.safeParse({
      email: 'TEST@test.com',
      password: 'pass',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@test.com');
      expect(result.data.remember_me).toBe(false);
    }
  });

  it('accepts optional totp_token', () => {
    const result = schemas.loginSchema.safeParse({
      email: 'a@b.com',
      password: 'pass',
      totp_token: '123456',
    });
    expect(result.success).toBe(true);
  });

  it('accepts remember_me true', () => {
    const result = schemas.loginSchema.safeParse({
      email: 'a@b.com',
      password: 'pass',
      remember_me: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.remember_me).toBe(true);
  });

  it('rejects empty password', () => {
    const result = schemas.loginSchema.safeParse({
      email: 'a@b.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Contact schemas ───────────────────────────────────────────
describe('createContactSchema', () => {
  it('accepts minimal valid contact', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
      expect(result.data.score).toBe(0);
      expect(result.data.custom_fields).toEqual({});
    }
  });

  it('rejects empty first_name', () => {
    const result = schemas.createContactSchema.safeParse({ first_name: '' });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from first_name', () => {
    const result = schemas.createContactSchema.safeParse({ first_name: '  Jane  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.first_name).toBe('Jane');
  });

  it('rejects first_name > 100 chars', () => {
    const result = schemas.createContactSchema.safeParse({ first_name: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('validates email format', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
      email: 'invalid-email',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid lead_status', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
      lead_status: 'qualified',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid lead_status', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
      lead_status: 'invalid-status',
    });
    expect(result.success).toBe(false);
  });

  it('accepts score as string (coerced)', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
      score: '50',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.score).toBe(50);
  });

  it('rejects score > 1000', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
      score: 1001,
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty string for email (nullable)', () => {
    const result = schemas.createContactSchema.safeParse({
      first_name: 'Jane',
      email: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('contactQuerySchema', () => {
  it('applies defaults', () => {
    const result = schemas.contactQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(0);
      expect(result.data.limit).toBe(25);
    }
  });

  it('coerces string numbers', () => {
    const result = schemas.contactQuerySchema.safeParse({ offset: '10', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(10);
      expect(result.data.limit).toBe(50);
    }
  });

  it('rejects limit > 200', () => {
    const result = schemas.contactQuerySchema.safeParse({ limit: 201 });
    expect(result.success).toBe(false);
  });
});

// ─── Deal schemas ──────────────────────────────────────────────
describe('createDealSchema', () => {
  it('accepts minimal deal', () => {
    const result = schemas.createDealSchema.safeParse({ title: 'Big Deal' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(0);
    }
  });

  it('rejects empty title', () => {
    const result = schemas.createDealSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title > 200 chars', () => {
    const result = schemas.createDealSchema.safeParse({ title: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('accepts amount as string (coerced)', () => {
    const result = schemas.createDealSchema.safeParse({ title: 'Deal', amount: '5000.50' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe(5000.50);
  });
});

// ─── Invoice schemas ───────────────────────────────────────────
describe('createInvoiceSchema', () => {
  const validInvoice = {
    line_items: [{ description: 'Item', quantity: 1, unit_price: 100 }],
  };

  it('accepts valid invoice with line items', () => {
    const result = schemas.createInvoiceSchema.safeParse(validInvoice);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
      expect(result.data.discount).toBe(0);
      expect(result.data.tax_rate).toBe(0);
    }
  });

  it('rejects empty line_items', () => {
    const result = schemas.createInvoiceSchema.safeParse({ line_items: [] });
    expect(result.success).toBe(false);
  });

  it('rejects missing line_items', () => {
    const result = schemas.createInvoiceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid status values', () => {
    for (const status of ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded', 'partially_paid', 'void']) {
      const result = schemas.createInvoiceSchema.safeParse({
        ...validInvoice,
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = schemas.createInvoiceSchema.safeParse({
      ...validInvoice,
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('validates line item tax_rate max 100', () => {
    const result = schemas.createInvoiceSchema.safeParse({
      line_items: [{ description: 'Item', quantity: 1, unit_price: 100, tax_rate: 101 }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Bulk delete schema ────────────────────────────────────────
describe('bulkDeleteSchema', () => {
  it('accepts valid UUID array', () => {
    const result = schemas.bulkDeleteSchema.safeParse({ ids: [UUID] });
    expect(result.success).toBe(true);
  });

  it('accepts up to 1000 IDs', () => {
    const ids = Array.from({ length: 1000 }, () => UUID);
    const result = schemas.bulkDeleteSchema.safeParse({ ids });
    expect(result.success).toBe(true);
  });

  it('rejects > 1000 IDs', () => {
    const ids = Array.from({ length: 1001 }, () => UUID);
    const result = schemas.bulkDeleteSchema.safeParse({ ids });
    expect(result.success).toBe(false);
  });

  it('rejects empty array', () => {
    const result = schemas.bulkDeleteSchema.safeParse({ ids: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    const result = schemas.bulkDeleteSchema.safeParse({ ids: ['not-a-uuid'] });
    expect(result.success).toBe(false);
  });
});

// ─── Bulk update schema ────────────────────────────────────────
describe('bulkUpdateSchema', () => {
  it('accepts valid update payload', () => {
    const result = schemas.bulkUpdateSchema.safeParse({
      ids: [UUID],
      updates: { status: 'active' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty ids', () => {
    const result = schemas.bulkUpdateSchema.safeParse({
      ids: [],
      updates: { status: 'active' },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Export schema ─────────────────────────────────────────────
describe('exportSchema', () => {
  it('accepts valid export request', () => {
    const result = schemas.exportSchema.safeParse({ entity_type: 'contacts' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('csv');
    }
  });

  it('rejects invalid entity_type', () => {
    const result = schemas.exportSchema.safeParse({ entity_type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts json format', () => {
    const result = schemas.exportSchema.safeParse({ entity_type: 'deals', format: 'json' });
    expect(result.success).toBe(true);
  });
});

// ─── Import schema ─────────────────────────────────────────────
describe('importSchema', () => {
  it('accepts valid import', () => {
    const result = schemas.importSchema.safeParse({
      entity_type: 'contacts',
      data: [{ name: 'John' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skip_duplicates).toBe(true);
    }
  });

  it('rejects empty data', () => {
    const result = schemas.importSchema.safeParse({
      entity_type: 'contacts',
      data: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects > 10000 records', () => {
    const data = Array.from({ length: 10001 }, () => ({ name: 'X' }));
    const result = schemas.importSchema.safeParse({
      entity_type: 'contacts',
      data,
    });
    expect(result.success).toBe(false);
  });
});

// ─── Search schema ─────────────────────────────────────────────
describe('searchSchema', () => {
  it('accepts valid search', () => {
    const result = schemas.searchSchema.safeParse({ q: 'test query' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(0);
      expect(result.data.limit).toBe(20);
    }
  });

  it('rejects empty q', () => {
    const result = schemas.searchSchema.safeParse({ q: '' });
    expect(result.success).toBe(false);
  });

  it('rejects q > 200 chars', () => {
    const result = schemas.searchSchema.safeParse({ q: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});

// ─── 2FA schemas ───────────────────────────────────────────────
describe('verify2faSchema', () => {
  it('accepts valid 6-digit token', () => {
    const result = schemas.verify2faSchema.safeParse({
      token: '123456',
      password: 'mypassword',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-6-digit token', () => {
    const result = schemas.verify2faSchema.safeParse({
      token: '12345',
      password: 'mypassword',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric token', () => {
    const result = schemas.verify2faSchema.safeParse({
      token: 'abcdef',
      password: 'mypassword',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = schemas.verify2faSchema.safeParse({
      token: '123456',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Email template schema ─────────────────────────────────────
describe('createEmailTemplateSchema', () => {
  it('accepts valid template', () => {
    const result = schemas.createEmailTemplateSchema.safeParse({
      name: 'Welcome',
      subject: 'Hello!',
      body: '<p>Welcome</p>',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variables).toEqual([]);
    }
  });

  it('rejects empty name', () => {
    const result = schemas.createEmailTemplateSchema.safeParse({
      name: '',
      subject: 'Hello',
      body: 'Content',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty body', () => {
    const result = schemas.createEmailTemplateSchema.safeParse({
      name: 'Template',
      subject: 'Hello',
      body: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Webhook schema ────────────────────────────────────────────
describe('createWebhookSchema', () => {
  it('accepts valid webhook', () => {
    const result = schemas.createWebhookSchema.safeParse({
      name: 'My Webhook',
      url: 'https://example.com/hook',
      events: ['deal.created'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty events', () => {
    const result = schemas.createWebhookSchema.safeParse({
      name: 'Hook',
      url: 'https://example.com',
      events: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Create tenant schema ──────────────────────────────────────
describe('createTenantSchema', () => {
  it('accepts valid tenant', () => {
    const result = schemas.createTenantSchema.safeParse({
      name: 'Acme Corp',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plan_id).toBe('free');
      expect(result.data.status).toBe('active');
      expect(result.data.primary_color).toBe('#7c3aed');
    }
  });

  it('rejects empty name', () => {
    const result = schemas.createTenantSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid primary_color', () => {
    const result = schemas.createTenantSchema.safeParse({
      name: 'Test',
      primary_color: 'not-a-color',
    });
    expect(result.success).toBe(false);
  });

  it('accepts 3-char hex color', () => {
    const result = schemas.createTenantSchema.safeParse({
      name: 'Test',
      primary_color: '#fff',
    });
    expect(result.success).toBe(true);
  });
});

// ─── KB category schema ────────────────────────────────────────
describe('createKbCategorySchema', () => {
  it('accepts valid slug', () => {
    const result = schemas.createKbCategorySchema.safeParse({
      name: 'Getting Started',
      slug: 'getting-started',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe('getting-started');
    }
  });

  it('lowercases slug via transform', () => {
    const result = schemas.createKbCategorySchema.safeParse({
      name: 'Test',
      slug: 'UPPER-SLUG',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slug).toBe('upper-slug');
  });

  it('rejects slug with special chars', () => {
    const result = schemas.createKbCategorySchema.safeParse({
      name: 'Test',
      slug: 'invalid slug!',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Tag action schema ─────────────────────────────────────────
describe('tagActionSchema', () => {
  it('accepts rename action', () => {
    const result = schemas.tagActionSchema.safeParse({
      action: 'rename',
      tag: 'old-tag',
      new_tag: 'new-tag',
    });
    expect(result.success).toBe(true);
  });

  it('accepts merge action', () => {
    const result = schemas.tagActionSchema.safeParse({
      action: 'merge',
      tags: ['tag1', 'tag2'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = schemas.tagActionSchema.safeParse({
      action: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects tag with invalid chars', () => {
    const result = schemas.tagActionSchema.safeParse({
      action: 'rename',
      tag: 'bad@tag!',
    });
    expect(result.success).toBe(false);
  });
});

// ─── IP whitelist schema ───────────────────────────────────────
describe('ipWhitelistSchema', () => {
  it('accepts valid IPs', () => {
    const result = schemas.ipWhitelistSchema.safeParse({
      ips: ['192.168.1.1', '10.0.0.0/8'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-IP strings', () => {
    const result = schemas.ipWhitelistSchema.safeParse({
      ips: ['not-an-ip'],
    });
    expect(result.success).toBe(false);
  });

  it('defaults to enabled=true', () => {
    const result = schemas.ipWhitelistSchema.safeParse({ ips: [] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(true);
  });
});

// ─── Quote schemas ─────────────────────────────────────────────
describe('createQuoteSchema', () => {
  it('accepts valid quote', () => {
    const result = schemas.createQuoteSchema.safeParse({
      title: 'Proposal',
      line_items: [{ description: 'Service', quantity: 1, unit_price: 5000 }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('draft');
  });

  it('rejects empty title', () => {
    const result = schemas.createQuoteSchema.safeParse({
      title: '',
      line_items: [{ description: 'Item', quantity: 1, unit_price: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Order schema ──────────────────────────────────────────────
describe('createOrderSchema', () => {
  it('accepts valid order', () => {
    const result = schemas.createOrderSchema.safeParse({
      line_items: [{ description: 'Widget', quantity: 5, unit_price: 10 }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('pending');
  });
});

// ─── Contract schema ───────────────────────────────────────────
describe('createContractSchema', () => {
  it('accepts valid contract', () => {
    const result = schemas.createContractSchema.safeParse({
      title: 'Service Agreement',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
      expect(result.data.value).toBe(0);
    }
  });
});

// ─── Workflow schema ───────────────────────────────────────────
describe('createWorkflowSchema', () => {
  it('accepts valid workflow', () => {
    const result = schemas.createWorkflowSchema.safeParse({
      name: 'Deal Follow-up',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trigger_type).toBe('event');
      expect(result.data.is_active).toBe(true);
    }
  });
});

// ─── Automation schema ─────────────────────────────────────────
describe('createAutomationSchema', () => {
  it('accepts valid automation', () => {
    const result = schemas.createAutomationSchema.safeParse({
      name: 'Auto-assign',
      event: 'contact.created',
      actions: [{ type: 'assign' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty actions', () => {
    const result = schemas.createAutomationSchema.safeParse({
      name: 'No actions',
      event: 'test',
      actions: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Sequence schema ───────────────────────────────────────────
describe('createSequenceSchema', () => {
  it('accepts valid sequence', () => {
    const result = schemas.createSequenceSchema.safeParse({
      name: 'Onboarding Series',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
      expect(result.data.steps).toEqual([]);
    }
  });
});

// ─── API Key schema ────────────────────────────────────────────
describe('createApiKeySchema', () => {
  it('accepts valid API key', () => {
    const result = schemas.createApiKeySchema.safeParse({
      name: 'Production Key',
      scopes: ['read', 'write'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty scopes', () => {
    const result = schemas.createApiKeySchema.safeParse({
      name: 'Key',
      scopes: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Form schema ───────────────────────────────────────────────
describe('createFormSchema', () => {
  it('accepts valid form', () => {
    const result = schemas.createFormSchema.safeParse({
      name: 'Contact Form',
      fields: [{ id: 'f1', label: 'Name', type: 'text' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty fields', () => {
    const result = schemas.createFormSchema.safeParse({
      name: 'Form',
      fields: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Role schema ───────────────────────────────────────────────
describe('createRoleSchema', () => {
  it('accepts valid role', () => {
    const result = schemas.createRoleSchema.safeParse({
      name: 'Manager',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permissions).toEqual({});
      expect(result.data.is_system).toBe(false);
    }
  });
});

// ─── Backup schema ─────────────────────────────────────────────
describe('createBackupSchema', () => {
  it('defaults to full backup', () => {
    const result = schemas.createBackupSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.backup_type).toBe('full');
  });

  it('accepts selective backup', () => {
    const result = schemas.createBackupSchema.safeParse({ backup_type: 'selective' });
    expect(result.success).toBe(true);
  });
});

// ─── Custom field schema ───────────────────────────────────────
describe('createCustomFieldSchema', () => {
  it('accepts valid custom field', () => {
    const result = schemas.createCustomFieldSchema.safeParse({
      entityType: 'contact',
      fieldKey: 'annual_revenue',
      fieldLabel: 'Annual Revenue',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fieldType).toBe('text');
      expect(result.data.isRequired).toBe(false);
    }
  });

  it('rejects fieldKey with special chars', () => {
    const result = schemas.createCustomFieldSchema.safeParse({
      entityType: 'contact',
      fieldKey: 'invalid key!',
      fieldLabel: 'Bad',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid field types', () => {
    const types = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url', 'email', 'phone', 'currency', 'json'];
    for (const fieldType of types) {
      const result = schemas.createCustomFieldSchema.safeParse({
        entityType: 'contact',
        fieldKey: `field_${fieldType}`,
        fieldLabel: fieldType,
        fieldType,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ─── Preferences patch schema ──────────────────────────────────
describe('preferencesPatchSchema', () => {
  it('accepts valid theme', () => {
    const result = schemas.preferencesPatchSchema.safeParse({ theme: 'dark' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid theme', () => {
    const result = schemas.preferencesPatchSchema.safeParse({ theme: 'rainbow' });
    expect(result.success).toBe(false);
  });

  it('accepts valid locale', () => {
    const result = schemas.preferencesPatchSchema.safeParse({ locale: 'en-US' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid locale format', () => {
    const result = schemas.preferencesPatchSchema.safeParse({ locale: 'english' });
    expect(result.success).toBe(false);
  });

  it('accepts all accent colors', () => {
    const colors = ['violet', 'indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'slate'];
    for (const color of colors) {
      const result = schemas.preferencesPatchSchema.safeParse({ accent_color: color });
      expect(result.success).toBe(true);
    }
  });
});

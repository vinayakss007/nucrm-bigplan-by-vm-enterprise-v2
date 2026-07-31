import { describe, it, expect } from 'vitest';

describe('api/schemas', () => {
  it('loginSchema accepts valid input', async () => {
    const { loginSchema } = await import('@/lib/api/schemas');
    const result = loginSchema.parse({ email: 'Test@Example.com', password: 'secret' });
    expect(result.email).toBe('test@example.com');
    expect(result.password).toBe('secret');
  });

  it('loginSchema rejects invalid email', async () => {
    const { loginSchema } = await import('@/lib/api/schemas');
    expect(() => loginSchema.parse({ email: 'invalid', password: 'secret' })).toThrow();
  });

  it('signupSchema transforms email to lowercase', async () => {
    const { signupSchema } = await import('@/lib/api/schemas');
    const result = signupSchema.parse({ email: 'User@Test.com', password: '12345678', full_name: 'User', workspace_name: 'Workspace' });
    expect(result.email).toBe('user@test.com');
  });

  it('createContactSchema validates URL fields', async () => {
    const { createContactSchema } = await import('@/lib/api/schemas');
    const result = createContactSchema.parse({
      first_name: 'John',
      email: 'john@test.com',
      website: 'example.com',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.website).toBe('https://example.com');
  });

  it('createContactSchema rejects missing first_name', async () => {
    const { createContactSchema } = await import('@/lib/api/schemas');
    expect(() => createContactSchema.parse({})).toThrow();
  });

  it('createDealSchema accepts valid deal with stage_id', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({
      title: 'Big Deal',
      stage_id: '00000000-0000-0000-0000-000000000000',
      pipeline_id: '00000000-0000-0000-0000-000000000000',
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.title).toBe('Big Deal');
    expect(result.amount).toBe(0);
  });

  it('createDealSchema accepts stage_name from frontend', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({
      title: 'New Deal',
      stage_name: 'lead',
    });
    expect(result.title).toBe('New Deal');
    expect(result.stage_name).toBe('lead');
  });

  it('createDealSchema accepts stage (name string) as fallback', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({
      title: 'Deal via stage',
      stage: 'qualified',
    });
    expect(result.stage).toBe('qualified');
  });

  it('createDealSchema accepts title-only (stage validated by route handler)', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({ title: 'Minimal Deal' });
    expect(result.title).toBe('Minimal Deal');
    expect(result.stage_id).toBeUndefined();
    expect(result.stage_name).toBeUndefined();
  });

  it('createCompanySchema applies https to bare domain', async () => {
    const { createCompanySchema } = await import('@/lib/api/schemas');
    const result = createCompanySchema.parse({
      name: 'Test Corp',
      website: 'testcorp.com',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.website).toBe('https://testcorp.com');
  });

  it('createCompanySchema preserves https prefix', async () => {
    const { createCompanySchema } = await import('@/lib/api/schemas');
    const result = createCompanySchema.parse({
      name: 'Test Corp',
      website: 'https://testcorp.com',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.website).toBe('https://testcorp.com');
  });

  it('createLeadSchema defaults status to new', async () => {
    const { createLeadSchema } = await import('@/lib/api/schemas');
    const result = createLeadSchema.parse({
      first_name: 'Jane',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.status).toBe('new');
    expect(result.score).toBe(0);
  });

  it('createTaskSchema defaults status and priority', async () => {
    const { createTaskSchema } = await import('@/lib/api/schemas');
    const result = createTaskSchema.parse({
      title: 'Test Task',
      contact_id: '00000000-0000-0000-0000-000000000000',
      deal_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.status).toBe('pending');
    expect(result.priority).toBe('medium');
  });

  it('bulkDeleteSchema accepts array of UUIDs', async () => {
    const { bulkDeleteSchema } = await import('@/lib/api/schemas');
    const result = bulkDeleteSchema.parse({ ids: ['00000000-0000-0000-0000-000000000000'] });
    expect(result.ids).toHaveLength(1);
  });

  it('bulkDeleteSchema rejects empty array', async () => {
    const { bulkDeleteSchema } = await import('@/lib/api/schemas');
    expect(() => bulkDeleteSchema.parse({ ids: [] })).toThrow();
  });

  it('forgotPasswordSchema accepts valid email', async () => {
    const { forgotPasswordSchema } = await import('@/lib/api/schemas');
    const result = forgotPasswordSchema.parse({ email: 'user@test.com' });
    expect(result.email).toBe('user@test.com');
  });

  it('resetPasswordSchema accepts valid token and password', async () => {
    const { resetPasswordSchema } = await import('@/lib/api/schemas');
    const result = resetPasswordSchema.parse({ token: 'abc123', password: 'newpassword' });
    expect(result.token).toBe('abc123');
    expect(result.password).toBe('newpassword');
  });

  it('verify2faSchema validates a 6-digit totp_code', async () => {
    const { verify2faSchema } = await import('@/lib/api/schemas');
    const result = verify2faSchema.parse({ token: '123456', password: 'password123' });
    expect(result.token).toBe('123456');
  });

  it('verify2faSchema rejects a non-6-digit totp_code', async () => {
    const { verify2faSchema } = await import('@/lib/api/schemas');
    expect(() => verify2faSchema.parse({ token: '12345', password: 'password123' })).toThrow();
    expect(() => verify2faSchema.parse({ token: '1234567', password: 'password123' })).toThrow();
    expect(() => verify2faSchema.parse({ token: 'abcdef', password: 'password123' })).toThrow();
    expect(() => verify2faSchema.parse({ password: 'password123' })).toThrow();
  });

  it('disable2faSchema requires a password and accepts an optional totp_code', async () => {
    const { disable2faSchema } = await import('@/lib/api/schemas');
    expect(() => disable2faSchema.parse({ password: 'mypassword' })).toThrow();
    expect(disable2faSchema.parse({ password: 'mypassword', token: '123456' }).token).toBe('123456');
    expect(() => disable2faSchema.parse({})).toThrow();
    expect(() => disable2faSchema.parse({ password: 'mypassword', token: '123' })).toThrow();
  });

  it('createInvoiceSchema requires at least one line item', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    expect(() => createInvoiceSchema.parse({
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      line_items: [],
    })).toThrow(/line item/i);
  });

  it('createInvoiceSchema rejects a line item missing its description', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    expect(() => createInvoiceSchema.parse({
      title: 'Invoice',
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      line_items: [{ quantity: 1, unit_price: 100 }],
    })).toThrow(/description/i);
  });

  it('createInvoiceSchema defaults status to draft', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    const result = createInvoiceSchema.parse({
      title: 'Invoice for services',
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      line_items: [{ description: 'Item', quantity: 1, unit_price: 100 }],
    });
    expect(result.status).toBe('draft');
    expect(result.line_items).toHaveLength(1);
  });

  it('importSchema defaults skip_duplicates to true', async () => {
    const { importSchema } = await import('@/lib/api/schemas');
    const result = importSchema.parse({
      entity_type: 'contacts',
      data: [{ name: 'Test' }],
    });
    expect(result.skip_duplicates).toBe(true);
  });

  it('exportSchema rejects invalid entity_type', async () => {
    const { exportSchema } = await import('@/lib/api/schemas');
    expect(() => exportSchema.parse({ entity_type: 'invalid' })).toThrow();
  });

  it('createBackupSchema defaults to full backup', async () => {
    const { createBackupSchema } = await import('@/lib/api/schemas');
    const result = createBackupSchema.parse({});
    expect(result.backup_type).toBe('full');
  });

  it('createCustomFieldSchema validates fieldKey format', async () => {
    const { createCustomFieldSchema } = await import('@/lib/api/schemas');
    const result = createCustomFieldSchema.parse({ entityType: 'contacts', fieldKey: 'my_field_1', fieldLabel: 'My Field' });
    expect(result.fieldKey).toBe('my_field_1');
  });

  it('createCustomFieldSchema rejects invalid fieldKey', async () => {
    const { createCustomFieldSchema } = await import('@/lib/api/schemas');
    expect(() => createCustomFieldSchema.parse({ entityType: 'contacts', fieldKey: 'my-field!', fieldLabel: 'My Field' })).toThrow();
  });

  it('aiAssistantSchema accepts valid action', async () => {
    const { aiAssistantSchema } = await import('@/lib/api/schemas');
    const result = aiAssistantSchema.parse({ action: 'draft_email' });
    expect(result.action).toBe('draft_email');
  });

  it('createAnnouncementSchema defaults type to info', async () => {
    const { createAnnouncementSchema } = await import('@/lib/api/schemas');
    const result = createAnnouncementSchema.parse({ title: 'Announcement' });
    expect(result.type).toBe('info');
    expect(result.target).toBe('all');
  });

  it('createWebhookSchema requires at least one event', async () => {
    const { createWebhookSchema } = await import('@/lib/api/schemas');
    expect(() => createWebhookSchema.parse({ name: 'Webhook', url: 'https://example.com/hook', events: [] })).toThrow();
  });

  it('updateContactSchema makes all fields optional', async () => {
    const { updateContactSchema } = await import('@/lib/api/schemas');
    const result = updateContactSchema.parse({});
    expect(result).toBeDefined();
  });

  it('preferencesPatchSchema validates locale format', async () => {
    const { preferencesPatchSchema } = await import('@/lib/api/schemas');
    expect(preferencesPatchSchema.parse({ locale: 'en-US' }).locale).toBe('en-US');
    expect(() => preferencesPatchSchema.parse({ locale: 'invalid' })).toThrow();
  });

  it('preferencesPatchSchema validates theme values', async () => {
    const { preferencesPatchSchema } = await import('@/lib/api/schemas');
    expect(() => preferencesPatchSchema.parse({ theme: 'invalid' })).toThrow();
  });
});
